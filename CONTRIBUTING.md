# Contributing to DarkFlow

- Fork the repository and create a feature branch.
- Keep changes focused and well-documented.
- Follow existing code style and module patterns.
- Reference files and lines in PR descriptions using file links.
- Add tests for new program instructions or keeper logic.
- For frontend, keep UI minimal and privacy-focused.
- Do not include secrets or keys in commits.
- Run local checks:
  - Frontend: yarn --cwd web build
  - Program tests: anchor test
  - Keeper: yarn run keeper (devnet)
- Submit PRs with:
  - Motivation and scope
  - Implementation details
  - Risks and mitigations
  - Testing steps and results
