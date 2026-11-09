-- =====================================================================
-- CARDÁPIO INICIAL (OPCIONAL) — ponto de partida editável pelo painel.
-- Não contém vendas nem indicadores. Fotos devem ser enviadas pelo
-- painel (Cardápio → Produto → Foto), que grava no Supabase Storage.
-- Aplicar: psql "$DATABASE_URL" -f supabase/seed_catalog_demo.sql
-- =====================================================================
insert into public.categories(name, slug, sort_order, description) values
  ('Frangos assados','frangos',1,'Assados lentamente na brasa, temperados na casa'),
  ('Marmitas','marmitas',2,'Refeição completa, pronta para levar'),
  ('Carnes','carnes',3,'Cortes assados e grelhados'),
  ('Massas','massas',4,'Massas frescas feitas aqui'),
  ('Lasanhas','lasanhas',5,'Gratinadas e generosas'),
  ('Acompanhamentos','acompanhamentos',6,'Para completar a mesa'),
  ('Saladas','saladas',7,'Frescas e leves'),
  ('Sobremesas','sobremesas',8,'O final perfeito'),
  ('Bebidas','bebidas',9,'Geladas'),
  ('Combos','combos',0,'Mais sabor por menos')
on conflict (slug) do nothing;

with c as (select slug, id from public.categories)
insert into public.products(category_id, sku, name, description, price, product_type, prep_time_minutes, is_featured, is_popular, serves, tags, send_to_kitchen, sort_order)
select c.id, v.sku, v.name, v.descr, v.price, v.ptype, v.prep, v.feat, v.pop, v.serves, v.tags, v.kitchen, v.ord
from (values
  ('frangos','FR01','Frango assado inteiro','Frango inteiro temperado por 12 horas e assado na brasa, com farofa da casa.',54.90,'preparado',20,true,true,4,'{mais_vendido}'::text[],true,1),
  ('frangos','FR02','Meio frango assado','Meio frango com o mesmo tempero tradicional e farofa.',31.90,'preparado',15,false,true,2,'{}'::text[],true,2),
  ('frangos','FR03','Frango recheado com farofa','Frango desossado recheado com farofa de bacon e linguiça.',74.90,'preparado',25,true,false,5,'{especial}'::text[],true,3),
  ('marmitas','MA01','Marmita executiva','Arroz, feijão, farofa, salada e porção de frango assado.',24.90,'preparado',10,false,true,1,'{}'::text[],true,1),
  ('marmitas','MA02','Marmita de costela','Arroz, feijão tropeiro, mandioca e costela assada.',32.90,'preparado',10,false,false,1,'{}'::text[],true,2),
  ('marmitas','MA03','Marmita fit','Arroz integral, legumes no vapor e peito de frango grelhado.',27.90,'preparado',10,false,false,1,'{fit}'::text[],true,3),
  ('carnes','CA01','Costela assada (kg)','Costela bovina assada por 8 horas, desmanchando.',89.90,'preparado',10,true,true,3,'{}'::text[],true,1),
  ('carnes','CA02','Cupim assado (kg)','Cupim macio, assado lentamente.',84.90,'preparado',10,false,false,3,'{}'::text[],true,2),
  ('carnes','CA03','Pernil assado (kg)','Pernil suíno marinado com ervas.',59.90,'preparado',10,false,false,3,'{}'::text[],true,3),
  ('massas','MS01','Nhoque ao sugo','Nhoque de batata artesanal com molho de tomate fresco.',38.90,'preparado',15,false,false,2,'{vegetariano}'::text[],true,1),
  ('massas','MS02','Talharim à bolonhesa','Massa fresca com molho de carne cozido lentamente.',42.90,'preparado',15,false,true,2,'{}'::text[],true,2),
  ('lasanhas','LA01','Lasanha à bolonhesa','Camadas de massa fresca, bolonhesa, presunto e queijo gratinado.',49.90,'preparado',20,true,true,3,'{}'::text[],true,1),
  ('lasanhas','LA02','Lasanha de frango com catupiry','Frango desfiado, catupiry e muçarela gratinada.',52.90,'preparado',20,false,true,3,'{}'::text[],true,2),
  ('acompanhamentos','AC01','Maionese da casa (500 g)','Batata, cenoura, ovos e maionese caseira.',18.90,'preparado',5,false,true,3,'{}'::text[],true,1),
  ('acompanhamentos','AC02','Farofa especial (300 g)','Farofa de bacon, ovos e cebola caramelizada.',14.90,'preparado',5,false,false,3,'{}'::text[],true,2),
  ('acompanhamentos','AC03','Arroz branco (500 g)','Arroz soltinho.',9.90,'preparado',5,false,false,3,'{}'::text[],true,3),
  ('acompanhamentos','AC04','Mandioca cozida na manteiga','Porção de mandioca com manteiga de garrafa.',16.90,'preparado',5,false,false,3,'{}'::text[],true,4),
  ('saladas','SA01','Salada verde','Folhas, tomate, pepino e cebola roxa.',15.90,'preparado',5,false,false,2,'{vegano}'::text[],true,1),
  ('saladas','SA02','Salada de maionese com frango','Clássica da casa com frango desfiado.',21.90,'preparado',5,false,false,2,'{}'::text[],true,2),
  ('sobremesas','SO01','Pudim de leite','Fatia generosa de pudim de leite condensado.',12.90,'preparado',2,false,true,1,'{}'::text[],false,1),
  ('sobremesas','SO02','Mousse de maracujá','Mousse aerado com calda da fruta.',10.90,'preparado',2,false,false,1,'{}'::text[],false,2),
  ('bebidas','BE01','Refrigerante 2 L','Consulte os sabores disponíveis.',13.90,'revenda',0,false,true,4,'{}'::text[],false,1),
  ('bebidas','BE02','Refrigerante lata 350 ml','Consulte os sabores disponíveis.',6.50,'revenda',0,false,false,1,'{}'::text[],false,2),
  ('bebidas','BE03','Suco natural 500 ml','Laranja, limão ou maracujá.',11.90,'preparado',5,false,false,1,'{}'::text[],true,3),
  ('bebidas','BE04','Água mineral 500 ml','Com ou sem gás.',4.50,'revenda',0,false,false,1,'{}'::text[],false,4),
  ('combos','CO01','Combo Família','Frango inteiro + maionese 500 g + farofa + refrigerante 2 L.',89.90,'combo',20,true,true,4,'{economia}'::text[],true,1),
  ('combos','CO02','Combo Casal','Meio frango + arroz + maionese 500 g + 2 latas.',59.90,'combo',15,true,false,2,'{economia}'::text[],true,2)
) v(cat, sku, name, descr, price, ptype, prep, feat, pop, serves, tags, kitchen, ord)
join c on c.slug = v.cat
on conflict (sku) do nothing;

-- composição dos combos
insert into public.combo_items(combo_product_id, product_id, quantity)
select (select id from public.products where sku = v.combo), (select id from public.products where sku = v.item), v.q
from (values ('CO01','FR01',1),('CO01','AC01',1),('CO01','AC02',1),('CO01','BE01',1),
             ('CO02','FR02',1),('CO02','AC03',1),('CO02','AC01',1),('CO02','BE02',2)) v(combo, item, q)
where not exists (select 1 from public.combo_items ci join public.products p on p.id = ci.combo_product_id where p.sku = v.combo);

-- opções
do $$
declare g uuid;
begin
  if not exists (select 1 from public.product_option_groups g join public.products p on p.id = g.product_id where p.sku = 'BE01') then
    insert into public.product_option_groups(product_id, name, min_select, max_select)
    select id, 'Sabor', 1, 1 from public.products where sku = 'BE01' returning id into g;
    insert into public.product_options(group_id, name, sort_order) values (g,'Cola',1),(g,'Guaraná',2),(g,'Laranja',3),(g,'Cola zero',4);
    insert into public.product_option_groups(product_id, name, min_select, max_select)
    select id, 'Sabor', 1, 1 from public.products where sku = 'BE02' returning id into g;
    insert into public.product_options(group_id, name, sort_order) values (g,'Cola',1),(g,'Guaraná',2),(g,'Laranja',3),(g,'Cola zero',4);
    insert into public.product_option_groups(product_id, name, min_select, max_select)
    select id, 'Sabor', 1, 1 from public.products where sku = 'BE03' returning id into g;
    insert into public.product_options(group_id, name, sort_order) values (g,'Laranja',1),(g,'Limão',2),(g,'Maracujá',3);
    insert into public.product_option_groups(product_id, name, min_select, max_select)
    select id, 'Adicionais', 0, 3 from public.products where sku = 'FR01' returning id into g;
    insert into public.product_options(group_id, name, price_delta, sort_order) values
      (g,'Farofa extra',6.00,1),(g,'Molho de alho',3.00,2),(g,'Batata assada',9.90,3);
    insert into public.product_option_groups(product_id, name, min_select, max_select)
    select id, 'Ponto do frango', 0, 1 from public.products where sku = 'FR01' returning id into g;
    insert into public.product_options(group_id, name, sort_order) values (g,'Normal',1),(g,'Bem passado',2),(g,'Pele crocante',3);
    insert into public.product_option_groups(product_id, name, min_select, max_select)
    select id, 'Feijão', 1, 1 from public.products where sku = 'MA01' returning id into g;
    insert into public.product_options(group_id, name, price_delta, sort_order) values (g,'Carioca',0,1),(g,'Preto',0,2),(g,'Tropeiro',3.00,3);
  end if;
end $$;

insert into public.banners(title, subtitle, link_url, sort_order)
select 'Frango assado na brasa', 'Temperado por 12 horas. Peça agora e retire quentinho.', '#frangos', 1
where not exists (select 1 from public.banners);
insert into public.banners(title, subtitle, link_url, sort_order)
select 'Combo Família', 'Frango + maionese + farofa + refri 2 L', '#combos', 2
where (select count(*) from public.banners) = 1;

insert into public.delivery_zones(district, city, fee, estimated_minutes) values
  ('Centro','',5.00,35),('Jardim América','',7.00,45),('Vila Nova','',8.00,50)
on conflict (district, city) do nothing;
