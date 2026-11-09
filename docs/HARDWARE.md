# Equipamentos e integrações

O sistema roda no navegador (Chrome ou Edge atualizados recomendados). Não há software a instalar nos computadores.

| Equipamento | Requisito | Como integra |
|---|---|---|
| Computador do caixa | Windows 10+/Linux/macOS, 4 GB RAM, Chrome/Edge | Painel `/admin/pdv` |
| Tablet da cozinha | Android 10+ ou iPad, tela ≥ 10" | `/admin/cozinha` em tela cheia, atualização em tempo real |
| Tablet do ponto | Android/iPad fixo na entrada | `/ponto` (quiosque com matrícula + PIN), token de dispositivo |
| Impressora térmica 80 mm | ESC/POS (Epson TM-T20, Elgin i9, Bematech MP-4200 e similares) | Navegador (driver) ou ESC/POS direto via Web Serial |
| Impressora térmica 58 mm | ESC/POS | Idem; comprovante ajusta para 32 colunas |
| Impressora da cozinha | Térmica 80 mm (rede ou USB) | Botão “Imprimir” na comanda (Pedidos/Cozinha) |
| Leitor de código de barras | USB/Bluetooth em modo teclado (HID) | Campo de busca do PDV: lê o código + Enter |
| Gaveta de dinheiro | Conector RJ11 ligado à impressora | Pulso ESC/POS `ESC p 0 25 250` ao finalizar venda em dinheiro |

## Formas de impressão

1. **Pelo navegador (recomendado para começar)**: instale o driver da impressora no sistema operacional, defina o papel (58 ou 80 mm, margens zero) e use os botões *Comprovante 80 mm / 58 mm* e *Comanda*. O layout já sai no tamanho da bobina. No Chrome, use o modo quiosque (`--kiosk-printing`) para imprimir sem a janela de diálogo.
2. **ESC/POS direto (Web Serial)**: para impressoras USB-serial/Serial. Em Configurações → Impressoras, escolha *ESC/POS direto*. O navegador pede, uma única vez, permissão para a porta. Permite **abrir a gaveta** e cortar o papel. Velocidade padrão 9600 bps (ajustável em `src/lib/escpos.ts`).
3. **Impressora de rede (cozinha)**: instale-a como impressora do sistema no tablet/PC da cozinha e imprima pelo navegador.

Os comprovantes são **não fiscais**. A emissão de NFC-e/SAT exige integração com um emissor homologado (ex.: Focus NFe, PlugNotas, NFe.io), que pode ser acoplado na função `pos_checkout` via Edge Function — fora do escopo atual.

## Teste de homologação

Configurações → Impressoras → *Imprimir teste* para cada impressora; PDV → venda em dinheiro → *Abrir gaveta + imprimir*; leitor: cadastrar o código de barras no produto e ler no PDV.
