# Encontro — inscrições

Aplicação web instalável (PWA) para inscrições em eventos, com página pública e painel de organização.

## Evento

- **Quando:** janeiro de 2027, às 11h
- **Onde:** Clube Canto do Rio
- **Data:** será confirmada pela organização

Quando o dia for definido, preencha `EVENT_DATE` no arquivo `.env` no formato `2027-01-DD`.

## Executar localmente

Requisitos: Docker e Docker Compose.

1. Crie seu arquivo de configuração:

   ```bash
   cp .env.example .env
   nano .env
   ```

2. Gere duas senhas, executando o comando abaixo duas vezes:

   ```bash
   openssl rand -hex 32
   ```

   Use uma em `DB_PASSWORD` e outra em `APP_DB_PASSWORD` no `.env`. Defina também `ADMIN_EMAIL` com seu e-mail.

3. Gere a senha do painel:

   ```bash
   npm install
   npm run admin:hash
   ```

   Digite uma senha com pelo menos 14 caracteres. Copie os valores exibidos para `ADMIN_PASSWORD_SALT` e `ADMIN_PASSWORD_HASH` no `.env`.

4. Inicie a aplicação:

   ```bash
   sudo docker compose up --build -d
   sudo docker compose ps
   ```

Abra no navegador:

- Página de inscrições: <http://localhost:3000>
- Painel da organização: <http://localhost:3000/admin.html>

Para acompanhar os registros de execução: `sudo docker compose logs -f app`.
Para encerrar: `sudo docker compose down`. Os dados permanecem salvos no volume do banco.

## Desenvolvimento e testes

```bash
npm install
npm test
```

## Configuração e segurança

As configurações do evento e do painel ficam no `.env`. Não compartilhe esse arquivo nem o envie ao GitHub; use `.env.example` como modelo. Se alguma senha for exposta, gere outra e atualize a configuração.

O projeto não envia e-mails de confirmação. O dia do evento deve ser atualizado depois de confirmado pela organização.
