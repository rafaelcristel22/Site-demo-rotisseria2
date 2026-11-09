-- Testes de integração das operações críticas. Cada bloco gera exceção em falha.
\set ON_ERROR_STOP 1
begin;

-- Usuários: admin (primeiro), caixa, gerente
insert into auth.users(id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a','admin@teste.local','{"full_name":"Admin"}'),
  ('00000000-0000-0000-0000-00000000000c','caixa@teste.local','{"full_name":"Operador","role_code":"caixa","invited":true}'),
  ('00000000-0000-0000-0000-00000000000b','gerente@teste.local','{"full_name":"Gerente","role_code":"gerente","invited":true}')
on conflict do nothing;

do $$ begin
  assert (select role_code from public.users where email='admin@teste.local') = 'admin', 'primeiro usuário deve ser admin';
  assert (select role_code from public.users where email='caixa@teste.local') = 'caixa', 'papel do caixa';
end $$;
update public.users set authorization_pin_hash = extensions.crypt('4321', extensions.gen_salt('bf', 4)) where email = 'gerente@teste.local';
update public.company_settings set opening_hours = (select jsonb_object_agg(d::text, '{"open":"00:00","close":"23:59","closed":false}'::jsonb) from generate_series(0,6) d),
  loyalty_enabled = true;

-- Ficha técnica: frango inteiro consome 1 un de frango cru + 0,05 kg de tempero
insert into public.ingredients(name, unit, min_stock) values ('Frango cru', 'un', 5), ('Tempero da casa', 'kg', 1);
insert into public.recipes(product_id, name, yield_quantity, loss_percent)
  select id, 'Frango assado', 1, 0 from public.products where sku = 'FR01';
insert into public.recipe_items(recipe_id, ingredient_id, quantity)
  select r.id, i.id, case i.name when 'Frango cru' then 1 else 0.05 end
  from public.recipes r, public.ingredients i where r.name = 'Frango assado';
select public._inventory_apply((select id from public.ingredients where name='Frango cru'), null, 10, 'entrada', 15.00);
select public._inventory_apply((select id from public.ingredients where name='Frango cru'), null, 10, 'entrada', 17.00);
select public._inventory_apply((select id from public.ingredients where name='Tempero da casa'), null, 2, 'entrada', 30.00);
do $$ begin
  assert (select avg_cost from public.ingredients where name='Frango cru') = 16.0, 'custo médio ponderado';
  assert public.product_unit_cost((select id from public.products where sku='FR01')) = 17.5, 'custo pela ficha técnica';
end $$;

-- ===== Site público (anon) =====
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
do $$
declare m jsonb; r jsonb; v_zone uuid; v_fr uuid; v_opt uuid; ok boolean := false;
begin
  m := public.public_menu();
  assert jsonb_array_length(m->'products') > 10, 'cardápio público';
  assert not (m->'products'->0 ? 'cost'), 'cardápio não expõe custo';
  v_zone := (m->'delivery_zones'->0->>'id')::uuid;
  select (p->>'id')::uuid into v_fr from jsonb_array_elements(m->'products') p where p->>'name' = 'Frango assado inteiro';
  select (o->>'id')::uuid into v_opt from jsonb_array_elements(m->'products') p, jsonb_array_elements(p->'option_groups') g,
         jsonb_array_elements(g->'options') o where p->>'name' = 'Frango assado inteiro' and o->>'name' = 'Farofa extra';
  -- acesso direto a tabelas é negado
  begin perform 1 from public.orders limit 1; exception when insufficient_privilege then ok := true; end;
  assert ok, 'anon não pode ler a tabela orders';
  -- preço manipulado pelo cliente é ignorado
  r := public.place_public_order(jsonb_build_object(
    'customer', jsonb_build_object('name','Maria Teste','phone','(11) 98888-7777'),
    'fulfillment','delivery', 'delivery_zone_id', v_zone,
    'address', jsonb_build_object('street','Rua A','number','10'),
    'items', jsonb_build_array(jsonb_build_object('product_id', v_fr, 'quantity', 2, 'option_ids', jsonb_build_array(v_opt), 'price', 0.01)),
    'payment_method','dinheiro','change_for', 200, 'consents', jsonb_build_object('privacy', true, 'marketing', true)));
  assert (r->>'subtotal')::numeric = (54.90 + 6.00) * 2, 'subtotal calculado no servidor';
  assert (r->>'total')::numeric = (r->>'subtotal')::numeric + 5.00, 'total com taxa de entrega';
  perform set_config('test.tracking', r->>'tracking_code', false);
  assert (public.public_order_status(r->>'tracking_code')->>'status') = 'pendente', 'rastreio do pedido';
end $$;
reset role;

-- ===== Atendente aceita, cozinha prepara, entrega, acerto no caixa =====
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare v_order uuid; v_reg uuid; it record; v_stock numeric; r jsonb;
begin
  select id into v_order from public.orders where tracking_code = current_setting('test.tracking');
  perform public.accept_order(v_order);
end $$;
reset role;
do $$ declare v_stock numeric; begin
  select quantity into v_stock from public.v_stock_levels where name = 'Frango cru';
  assert v_stock = 18, 'baixa automática pela ficha técnica (esperado 18, obtido ' || coalesce(v_stock::text,'null') || ')';
end $$;
-- cozinha (admin tem todas as permissões)
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
declare v_order uuid; it record; d uuid;
begin
  select id into v_order from public.orders where tracking_code = current_setting('test.tracking');
  for it in select id from public.order_items where order_id = v_order loop perform public.kitchen_set_item_status(it.id, 'pronto'); end loop;
  assert (select status from public.orders where id = v_order) = 'aguardando_finalizacao', 'todos itens prontos';
  perform public.order_set_status(v_order, 'pronto');
  insert into public.delivery_drivers(name) values ('Entregador 1') returning id into d;
  perform public.assign_delivery(v_order, d);
  perform public.dispatch_delivery(v_order);
  perform public.finish_delivery(v_order, true);
  assert (select status from public.orders where id = v_order) = 'entregue', 'entregue';
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000c', true);
do $$
declare v_order uuid; v_reg uuid; r jsonb; v_total numeric; s jsonb; v_fr uuid; ok boolean := false;
begin
  v_reg := public.open_cash_register('Caixa 1', 100);
  select id, total into v_order, v_total from public.orders where tracking_code = current_setting('test.tracking');
  r := public.settle_order(v_order, jsonb_build_array(jsonb_build_object('method','dinheiro','amount', v_total, 'tendered', 200)));
  assert (r->>'change')::numeric = 200 - v_total, 'troco';
  assert (select loyalty_points from public.customers where phone = '11988887777') > 0, 'pontos de fidelidade';

  -- PDV balcão: desconto de 20% exige PIN de gerente
  select id into v_fr from public.products where sku = 'FR02';
  begin
    perform public.pos_checkout(jsonb_build_object('cash_register_id', v_reg, 'channel','balcao',
      'items', jsonb_build_array(jsonb_build_object('product_id', v_fr, 'quantity', 1)),
      'discount_type','percentual','discount_value',20,
      'payments', jsonb_build_array(jsonb_build_object('method','pix','amount', 25.52))));
  exception when insufficient_privilege then ok := true; end;
  assert ok, 'desconto acima do limite sem PIN deve falhar';
  r := public.pos_checkout(jsonb_build_object('cash_register_id', v_reg, 'channel','balcao',
      'items', jsonb_build_array(jsonb_build_object('product_id', v_fr, 'quantity', 1)),
      'discount_type','percentual','discount_value',20, 'authorizer_pin','4321',
      'payments', jsonb_build_array(jsonb_build_object('method','pix','amount', 25.52))));
  assert (r->>'total')::numeric = 25.52, 'total com desconto';
  assert (select discount_authorized_by from public.orders where id = (r->>'order_id')::uuid) is not null, 'autorizador registrado';

  -- pagamento que não fecha o total é rejeitado
  ok := false;
  begin
    perform public.pos_checkout(jsonb_build_object('cash_register_id', v_reg, 'channel','balcao',
      'items', jsonb_build_array(jsonb_build_object('product_id', v_fr, 'quantity', 1)),
      'payments', jsonb_build_array(jsonb_build_object('method','pix','amount', 1))));
  exception when others then ok := true; end;
  assert ok, 'pagamento inferior ao total';

  -- cancelamento com PIN devolve estoque e estorna financeiro
  perform public.cancel_order((r->>'order_id')::uuid, 'Cliente desistiu da compra', '4321');
  assert (select status from public.sales where order_id = (r->>'order_id')::uuid) = 'cancelada', 'venda cancelada';

  s := public.cash_register_summary(v_reg);
  assert (s->>'expected_cash')::numeric = 100 + v_total, 'dinheiro esperado na gaveta';
  r := public.close_cash_register(v_reg, jsonb_build_object('dinheiro', 100 + v_total - 2, 'pix', 0));
  assert (r->>'difference')::numeric = -2, 'diferença de caixa (falta de R$ 2)';
end $$;
reset role;

-- ===== Auditoria e imutabilidade =====
do $$ declare ok boolean := false; begin
  assert (select count(*) from public.audit_logs where action = 'ORDER_CANCEL') = 1, 'cancelamento auditado';
  assert (select count(*) from public.financial_transactions where reference_type = 'estorno') >= 1, 'estorno financeiro';
  assert (select quantity from public.v_stock_levels where name = 'Frango cru') = 18, 'estoque inalterado (FR02 sem ficha)';
  assert (select count(*) from public.audit_logs where action = 'DISCOUNT_APPROVED') = 1, 'desconto auditado';
  begin delete from public.inventory_movements; exception when others then ok := true; end;
  assert ok, 'movimentações de estoque imutáveis';
  ok := false;
  begin update public.audit_logs set action = 'x'; exception when others then ok := true; end;
  assert ok, 'auditoria imutável';
end $$;

-- ===== Ponto eletrônico =====
insert into public.employees(code, full_name, cpf, schedule_id, hire_date, salary, user_id)
values ('1001', 'Funcionária Teste', '52998224725', (select id from public.schedules where name like 'Comercial%'), '2026-01-05', 2200,
        '00000000-0000-0000-0000-00000000000c');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
select public.set_employee_pin((select id from public.employees where code='1001'), '1234');
do $$
declare tok jsonb; r jsonb; ok boolean := false; v_emp uuid := (select id from public.employees where code='1001');
begin
  tok := public.register_timeclock_device('Tablet balcão', 'tablet_compartilhado');
  r := public.kiosk_punch(tok->>'token', '1001', '0000');
  assert not (r->>'ok')::boolean, 'PIN errado rejeitado';
  r := public.kiosk_punch(tok->>'token', '1001', '1234');
  assert (r->>'punch_type') = 'entrada', 'primeira marcação é entrada';
  begin perform public.kiosk_punch(tok->>'token', '1001', '1234'); exception when others then ok := true; end;
  assert ok, 'marcação duplicada bloqueada';
  ok := false;
  begin update public.time_clock_records set punched_at = punched_at - interval '1 hour'; exception when others then ok := true; end;
  assert ok, 'marcações não podem ser editadas';
  assert (public.timeclock_verify_chain()->>'ok')::boolean, 'cadeia de hashes íntegra';
end $$;
reset role;

-- Cálculo: dia útil de 7h20 previstas, trabalhou 8h20 → 60 min extras (50%); atraso de 20 min em outro dia
do $$
declare v_emp uuid := (select id from public.employees where code='1001'); c record; v_day date := '2026-03-03'; -- terça
begin
  perform public._timeclock_insert(v_emp, 'entrada', 'ajuste', null, (timestamp '2026-03-03 09:00' at time zone 'America/Sao_Paulo'), v_day);
  perform public._timeclock_insert(v_emp, 'intervalo_inicio', 'ajuste', null, (timestamp '2026-03-03 12:00' at time zone 'America/Sao_Paulo'), v_day);
  perform public._timeclock_insert(v_emp, 'intervalo_fim', 'ajuste', null, (timestamp '2026-03-03 13:00' at time zone 'America/Sao_Paulo'), v_day);
  perform public._timeclock_insert(v_emp, 'saida', 'ajuste', null, (timestamp '2026-03-03 18:20' at time zone 'America/Sao_Paulo'), v_day);
  perform public._timeclock_insert(v_emp, 'entrada', 'ajuste', null, (timestamp '2026-03-04 09:20' at time zone 'America/Sao_Paulo'), '2026-03-04');
  perform public._timeclock_insert(v_emp, 'saida', 'ajuste', null, (timestamp '2026-03-04 17:20' at time zone 'America/Sao_Paulo'), '2026-03-04');
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', true);
do $$
declare v_emp uuid := (select id from public.employees where code='1001'); c record;
begin
  select * into c from public.timeclock_calc(v_emp, '2026-03-03', '2026-03-03');
  assert c.expected_minutes = 440, 'jornada prevista 7h20 (obtido ' || c.expected_minutes || ')';
  assert c.worked_minutes = 500 and c.overtime_minutes = 60 and c.overtime_rate = 50, 'horas extras 50%: ' || c.worked_minutes || '/' || c.overtime_minutes;
  assert c.break_minutes = 60, 'intervalo';
  select * into c from public.timeclock_calc(v_emp, '2026-03-04', '2026-03-04');
  assert c.late_minutes = 20, 'atraso de 20 min';
  assert c.overtime_minutes = 40, '480 trabalhados vs 440 previstos = 40 extras (obtido ' || c.overtime_minutes || ')';
end $$;
reset role;

do $$ begin raise notice 'TODOS OS TESTES CRÍTICOS PASSARAM'; end $$;
rollback;
