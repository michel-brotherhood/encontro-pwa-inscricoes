# Encontro — PWA de inscrições

Aplicação em JavaScript com front-end PWA, API Node.js/Express e PostgreSQL. Inclui formulário público, painel administrativo autenticado, busca, exportação CSV e check-in.

## Evento configurado

- Mês: janeiro de 2027
- Horário: 11h
- Local: Clube Canto do Rio
- Dia exato: ainda não informado; `EVENT_DATE` fica vazio e a interface informa que será confirmado.

Atualize `EVENT_DATE=2027-01-DD` quando a organização confirmar o dia. A data deve pertencer a janeiro de 2027. Os demais dados ficam em variáveis de ambiente, sem valores inventados no código.

## Rodar com Docker Compose

1. Copie `.env.example` para `.env`.
2. Gere duas senhas independentes:

   ```bash
   openssl rand -hex 32
   openssl rand -hex 32
   ```

   Use uma em `DB_PASSWORD` (conta de migração PostgreSQL) e a outra em `APP_DB_PASSWORD` (credencial do papel runtime `event_app`). O Compose monta a senha runtime na URL de conexão do app.
3. Defina `ADMIN_EMAIL` e crie o hash da senha administrativa sem gravar a senha em texto puro:

   ```bash
   npm install
   npm run admin:hash
   ```

   Copie `ADMIN_PASSWORD_SALT` e `ADMIN_PASSWORD_HASH` para `.env`. Nunca versione ou compartilhe `.env`.
4. Inicie os serviços:

   ```bash
   docker compose up --build
   ```

A página pública fica em `http://localhost:3000`; o painel, em `http://localhost:3000/admin.html`. O serviço `migrate` aplica o schema e configura o evento antes de iniciar a API. O volume do PostgreSQL mantém os dados.

Para executar fora do Compose, configure `DATABASE_MIGRATION_URL`, `APP_DB_PASSWORD` e `DATABASE_URL` separadamente. `npm run db:init` exige uma credencial de migração com permissão para gerenciar roles e schema (e contornar RLS durante a configuração inicial). Inicie a API com uma conexão `DATABASE_URL` do papel `event_app`; não use a conta de migração no servidor web.

## Camadas de segurança implementadas

- `event_app` é criado sem `SUPERUSER`, `BYPASSRLS`, criação de banco/roles ou herança de privilégios. O container `app` não recebe a URL nem a senha de migração.
- RLS com `FORCE ROW LEVEL SECURITY` nas tabelas de eventos, inscrições e sessões. O contexto do evento é definido dentro de uma transação para cada operação, evitando vazamento pelo pool de conexões.
- Inscrição pública tem apenas `INSERT` nas colunas necessárias e fica limitada ao evento ativo pelas políticas. Consultas e check-in exigem hash de cookie de sessão administrativa ativo no banco.
- Sessões usam token aleatório em cookie `HttpOnly`, `SameSite=Strict` (e `Secure` em produção); somente o hash SHA-256 é persistido. Login e inscrição têm rate limit, mutações verificam origem e as queries usam parâmetros.
- A capacidade é atualizada atomicamente por trigger. A função `SECURITY DEFINER` pertence a um papel sem login, sem superusuário e com acesso somente à tabela de capacidade. O papel runtime não pode consultar ou editar diretamente essa tabela.
- Helmet/CSP, limite de payload, validação no servidor, mensagens de erro sem detalhes internos e service worker sem cache de `/api/`.

RLS é uma camada de defesa adicional: comprometimento total das credenciais runtime ainda permite operações concedidas ao papel `event_app`. Proteja também o segredo, o host do banco, o proxy e o ambiente de execução.

## API

- `GET /api/event`: configuração pública do evento ativo.
- `POST /api/registrations`: valida e registra inscrição; trata e-mail repetido e capacidade cheia.
- `POST /api/admin/login`, `GET /api/admin/session`, `POST /api/admin/logout`: sessão administrativa.
- `GET /api/admin/registrations`: busca paginada, autenticada.
- `PATCH /api/admin/registrations/:id/check-in`: registra ou desfaz check-in, autenticado.

## Testes

```bash
npm test
npm audit --omit=dev
```

Os testes unitários cobrem validação/normalização. Testes reais de API e políticas RLS precisam de PostgreSQL disponível. Para produção, confirme também HTTPS no proxy, backups e restore, domínio, política de privacidade/consentimento e operação do e-mail de confirmação.

Com várias réplicas da API, substitua o rate limiter em memória por um store compartilhado. O app ainda não envia e-mails nem oferece redefinição de senha; para trocar credenciais administrativas, gere novo salt/hash e reinicie com os valores atualizados.
