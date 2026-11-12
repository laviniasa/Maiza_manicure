# Studio Manicure

Sistema web instalável (PWA) para manicure: agenda, clientes, controle de retornos, WhatsApp com mensagem pronta e controle de caixa.

Tudo roda no **Render**:
- **Serviço web (Node.js):** serve o app e a API, com login por sessão segura.
- **Banco Render Postgres:** o servidor cria e atualiza as tabelas sozinho ao iniciar.

## Funcionalidades

| Módulo | O que faz |
| --- | --- |
| Início | Atendimentos do dia, retornos atrasados, saldo do mês e atalhos |
| Agenda | Calendário mensal, criar/editar/remarcar/cancelar, marcar falta, bloqueio de conflito de horário |
| Clientes | Cadastro, busca, observações, histórico, total gasto, botão de WhatsApp |
| Retornos | Prazo por serviço; ao concluir um atendimento a data de retorno é calculada. Listas de atrasados, próximos 7 dias e clientes que já reagendaram |
| WhatsApp | Abre a conversa com mensagem pronta (editável em Ajustes); a manicure revisa e envia |
| Caixa | Entradas e saídas por mês, categorias, valores a receber/pagar fora do saldo; ao concluir um atendimento a entrada é lançada automaticamente |
| Serviços | Nome, duração, preço e prazo de retorno |

## Estrutura

```
public/          app (HTML, CSS, JS puro, PWA)
server/          servidor Node: API, login, banco
  schema.sql     tabelas e regras (roda a cada início, sem perder dados)
test/            testes da API
render.yaml      configuração do Render
```

## Variáveis de ambiente (Render)

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Conexão do Postgres (preenchida pelo Render) |
| `SESSION_SECRET` | Chave das sessões (gerada pelo Render) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Conta da manicure, criada no primeiro início |
| `ADMIN_RESET_PASSWORD` | `true` redefine a senha para `ADMIN_PASSWORD` no próximo início. Remova depois, senão a sessão cai a cada reinício |

## Planos gratuitos do Render: atenção
- **Banco gratuito expira 30 dias após a criação.** Antes disso, mude o banco para um plano pago no painel do Render (os dados são mantidos). Depois de expirar há 14 dias de carência; passado isso, os dados são apagados.
- **Serviço web gratuito "dorme"** após 15 minutos sem uso e leva cerca de 1 minuto para abrir de novo.
- O plano gratuito não é indicado para produção; o pago resolve os dois pontos.

## Desenvolvimento local
```bash
npm install
DATABASE_URL=postgres://usuario:senha@localhost:5432/maiza ADMIN_EMAIL=voce@exemplo.com ADMIN_PASSWORD=senha12345 npm start
# abra http://localhost:3000
BASE=http://localhost:3000 node test/api-test.mjs   # testes (use um banco de teste)
```
Ao alterar arquivos do app, aumente a versão em `public/sw.js` para os celulares receberem a atualização.

## Próxima fase: envio automático pelo WhatsApp
O banco já guarda a autorização da cliente (`clients.whatsapp_opt_in`), a data prevista (`appointments.return_due`) e o registro de envio (`appointments.return_reminded_at`). A integração com a API oficial do WhatsApp Business pode rodar como um Cron Job do Render.
