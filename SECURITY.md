# Security Policy

- Reporting: please email security@privateswap.com with details.
- Scope: vulnerabilities in the Solana program, keeper, or frontend.
- Handling:
  - We acknowledge within 72 hours.
  - We assess severity and develop a fix.
  - We publish advisories when appropriate.
- Best Practices:
  - Keep Anchor and dependencies up to date.
  - Do not commit secrets; use environment variables and secure storage.
  - Run keeper with least privilege and monitored RPC endpoints.
  - Validate Jupiter routes and enforce min_out where possible.
- Disclosure: coordinated disclosure preferred; no public POCs against mainnet without coordination. 
