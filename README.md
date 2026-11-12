# Studio Manicure

Sistema web instalável (PWA) para manicure: agenda, clientes, controle de retornos, WhatsApp com mensagem pronta e controle de caixa.

- **Frontend:** HTML, CSS e JavaScript puro (sem etapa de build), hospedado no Render como site estático.
- **Backend:** Supabase (login, banco PostgreSQL e regras de segurança por conta).

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

## Configuração

### 1. Supabase
1. Crie um projeto em [supabase.com](https://supabase.com) (região São Paulo).
2. Em **SQL Editor**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. Em **Authentication > Sign In / Providers**, desative "Allow new users to sign up" (só a dona do studio acessa).
4. Em **Authentication > Users > Add user**, crie o usuário da manicure (e-mail e senha).
5. Em **Authentication > URL Configuration**, coloque a URL do site do Render em *Site URL* (necessário para "Esqueci minha senha").
6. Em **Project Settings > API**, copie a *Project URL* e a *anon public key* para `js/config.js`.

### 2. Render
1. Em [render.com](https://render.com): **New > Blueprint** e escolha este repositório (o `render.yaml` já configura tudo).
2. Cada `git push` na branch `main` publica uma nova versão.

### 3. Instalar no celular
Abra o site no navegador do celular e use **Adicionar à tela inicial**.

## Desenvolvimento local
```bash
python3 -m http.server 8000
# abra http://localhost:8000
```
Ao alterar arquivos do app, aumente a versão em `sw.js` (`studio-v1` → `studio-v2`) para os celulares receberem a atualização.

## Próxima fase: envio automático pelo WhatsApp
O banco já guarda a autorização da cliente (`clients.whatsapp_opt_in`), a data prevista (`appointments.return_due`) e o registro de envio (`appointments.return_reminded_at`). A integração com a API oficial do WhatsApp Business será feita com uma Edge Function do Supabase agendada (pg_cron).
