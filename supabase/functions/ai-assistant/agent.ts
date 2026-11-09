// Núcleo do assistente administrativo (independente de runtime).
// O modelo só tem ferramentas de LEITURA; cada ferramenta chama uma função do banco
// com o JWT de quem perguntou, então RLS e permissões continuam valendo.
import type Anthropic from '@anthropic-ai/sdk';

export const MODEL = 'claude-opus-5-5';

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
type Select = (view: string, limit: number) => Promise<unknown>;

const period = {
  type: 'object',
  properties: {
    start: { type: 'string', description: 'Data inicial AAAA-MM-DD (horário local da empresa)' },
    end: { type: 'string', description: 'Data final AAAA-MM-DD, inclusiva' },
  },
  required: ['start', 'end'],
  additionalProperties: false,
} as const;

interface ToolDef { name: string; description: string; input_schema: Record<string, unknown>; run: (i: any, rpc: Rpc, sel: Select) => Promise<unknown> }

const p = (i: any) => ({ p_start: i.start, p_end: i.end });
export const TOOLS: ToolDef[] = [
  { name: 'indicadores', description: 'Indicadores do período: faturamento (hoje, semana, mês, ano e do período), lucro bruto, lucro líquido estimado, despesas, pedidos, vendas, ticket médio, itens vendidos, pedidos pendentes, estoque baixo, contas a pagar/receber.', input_schema: period, run: (i, rpc) => rpc('dashboard_kpis', p(i)) },
  { name: 'faturamento_serie', description: 'Faturamento, nº de vendas, ticket médio, custo e lucro bruto agrupados por dia, semana, mês ou ano.', input_schema: { ...period, properties: { ...period.properties, granularity: { type: 'string', enum: ['day', 'week', 'month', 'year'] } }, required: ['start', 'end', 'granularity'] }, run: (i, rpc) => rpc('report_sales_series', { ...p(i), p_granularity: i.granularity }) },
  { name: 'ranking_produtos', description: 'Produtos vendidos no período com quantidade, receita, custo, lucro e margem.', input_schema: period, run: (i, rpc) => rpc('report_product_ranking', p(i)) },
  { name: 'vendas_por_categoria', description: 'Receita, custo e margem por categoria do cardápio.', input_schema: period, run: (i, rpc) => rpc('report_sales_by_category', p(i)) },
  { name: 'vendas_por_horario', description: 'Faturamento e vendas por hora do dia (0-23).', input_schema: period, run: (i, rpc) => rpc('report_sales_by_hour', p(i)) },
  { name: 'vendas_por_canal', description: 'Vendas por canal (balcão, retirada, entrega) e origem (pdv, site).', input_schema: period, run: (i, rpc) => rpc('report_channels', p(i)) },
  { name: 'vendas_por_funcionario', description: 'Vendas, faturamento, descontos e cancelamentos por operador.', input_schema: period, run: (i, rpc) => rpc('report_sales_by_operator', p(i)) },
  { name: 'formas_pagamento', description: 'Valores e taxas por forma de pagamento.', input_schema: period, run: (i, rpc) => rpc('report_payment_methods', p(i)) },
  { name: 'despesas_por_categoria', description: 'Despesas pagas por categoria e grupo do DRE (regime de competência).', input_schema: period, run: (i, rpc) => rpc('report_expenses_by_category', p(i)) },
  { name: 'dre', description: 'DRE gerencial do período: receita, CMV, lucro bruto, despesas por grupo, margem de contribuição, ponto de equilíbrio e resultado.', input_schema: period, run: (i, rpc) => rpc('report_dre', p(i)) },
  { name: 'fluxo_caixa', description: 'Entradas, saídas e previsões (contas a pagar/receber) por dia.', input_schema: period, run: (i, rpc) => rpc('report_cash_flow', p(i)) },
  { name: 'horas_por_departamento', description: 'Horas trabalhadas, horas extras, atrasos e faltas por departamento.', input_schema: period, run: (i, rpc) => rpc('report_hours_by_department', p(i)) },
  { name: 'cancelamentos', description: 'Pedidos cancelados com motivo, responsável e autorizador.', input_schema: period, run: (i, rpc) => rpc('report_cancellations', p(i)) },
  { name: 'desperdicio', description: 'Perdas registradas no estoque com custo.', input_schema: period, run: (i, rpc) => rpc('report_waste', p(i)) },
  { name: 'cozinha', description: 'Tempo médio de preparo, pedidos atrasados, tempo por produto e por horário.', input_schema: period, run: (i, rpc) => rpc('report_kitchen', p(i)) },
  { name: 'entregas', description: 'Desempenho das entregas por entregador e bairro.', input_schema: period, run: (i, rpc) => rpc('report_delivery', p(i)) },
  { name: 'estoque_atual', description: 'Posição atual de estoque: quantidade, mínimo, custo médio, valor e situação de cada item.', input_schema: { type: 'object', properties: {}, additionalProperties: false }, run: (_i, _rpc, sel) => sel('v_stock_levels', 500) },
  { name: 'sugestao_reposicao', description: 'Itens a repor com base no estoque mínimo e no consumo médio dos últimos 30 dias.', input_schema: { type: 'object', properties: { days_coverage: { type: 'integer', description: 'Dias de cobertura desejados' } }, required: ['days_coverage'], additionalProperties: false }, run: (i, rpc) => rpc('restock_suggestions', { p_days_coverage: i.days_coverage }) },
  { name: 'alertas', description: 'Alertas automáticos: tendência de vendas, horário de pico, margens baixas, inconsistências (estoque negativo, diferenças de caixa, produtos sem custo), contas vencidas.', input_schema: { type: 'object', properties: { days: { type: 'integer' } }, required: ['days'], additionalProperties: false }, run: (i, rpc) => rpc('business_insights', { p_days: i.days }) },
  { name: 'clientes', description: 'Clientes com total gasto, ticket médio, dias sem comprar e segmento (frequente, inativo, novo...).', input_schema: { type: 'object', properties: {}, additionalProperties: false }, run: (_i, rpc) => rpc('customer_segments', {}).then((r) => (r as unknown[]).slice(0, 100)) },
];

export function systemPrompt(today: string, tz: string) {
  return `Você é o assistente administrativo de uma rotisseria, dentro do ERP da empresa.
Hoje é ${today} (fuso ${tz}). Responda em português do Brasil, de forma direta, com números formatados em R$ e datas no padrão brasileiro.
Use SOMENTE os dados retornados pelas ferramentas. Se a ferramenta não trouxer dados ou der erro de permissão, diga isso claramente; nunca estime ou invente números.
Você não pode alterar nada (preços, estoque, ponto, financeiro, cadastros). Se pedirem uma alteração, explique onde no sistema a pessoa pode fazê-la.
Ao sugerir economia ou ações, baseie-se nos dados e indique de qual relatório veio cada número. Seja conciso.`;
}

export async function runAgent(opts: {
  client: Anthropic; question: string; history: { role: 'user' | 'assistant'; text: string }[];
  rpc: Rpc; select: Select; today: string; tz: string;
}): Promise<{ answer: string; tools: string[] }> {
  const { client, rpc, select } = opts;
  const tools = TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema, strict: true })) as unknown as Anthropic.Beta.BetaTool[];
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...opts.history.map((h) => ({ role: h.role, content: h.text })),
    { role: 'user', content: opts.question },
  ];
  const used: string[] = [];
  for (let step = 0; step < 8; step++) {
    // Fallback do lado do servidor em caso de recusa (opção padrão, roteia por categoria)
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: systemPrompt(opts.today, opts.tz),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      tools,
      messages,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as unknown as Anthropic.Beta.MessageCreateParamsNonStreaming);

    if (res.stop_reason === 'refusal') return { answer: 'Não posso responder a essa pergunta.', tools: used };
    if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
    const calls = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !calls.length) {
      const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
      return { answer: text || 'Sem resposta.', tools: used };
    }
    messages.push({ role: 'assistant', content: res.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = await Promise.all(calls.map(async (c) => {
      const def = TOOLS.find((t) => t.name === c.name);
      used.push(c.name);
      try {
        if (!def) throw new Error('Ferramenta desconhecida');
        const out = await def.run(c.input, rpc, select);
        const textOut = JSON.stringify(out);
        return { type: 'tool_result', tool_use_id: c.id, content: textOut.length > 60000 ? textOut.slice(0, 60000) + '…(truncado: refine o período)' : textOut };
      } catch (e) {
        return { type: 'tool_result', tool_use_id: c.id, content: `Erro: ${(e as Error).message}`, is_error: true };
      }
    }));
    messages.push({ role: 'user', content: results });
  }
  return { answer: 'A consulta ficou longa demais. Tente uma pergunta mais específica.', tools: used };
}
