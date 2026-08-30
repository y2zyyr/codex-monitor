# Security policy

## Reporting a vulnerability

Please report suspected vulnerabilities privately to the repository owner rather than opening a public issue. Do not include API keys, access tokens, bot tokens, database credentials, or other secrets in the report.

If a credential is accidentally exposed, rotate it immediately and then notify the repository owner so the affected history and deployment can be reviewed.

## Secret handling

- Local secrets belong in `.dev.vars`, which is ignored by Git.
- Production secrets belong in Cloudflare Worker secrets.
- `.dev.vars.example` contains placeholders only.
- Never commit credentials, private keys, or production database exports.
