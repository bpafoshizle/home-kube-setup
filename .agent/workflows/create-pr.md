---
description: Automatically create a branch, commit changes, and open a PR using Conventional Commits.
---

1. Analyze the current changes to determine the context (feature, bug fix, refactor, etc.).
2. Generate a branch name following the format `type/short-description` (e.g., `feat/add-clawhub-tokens`).
// turbo
3. Create and switch to the branch: `git checkout -b <branch_name>`.
// turbo
4. Stage all current changes: `git add .`.
5. Generate a conventional commit message (e.g., `feat(openclaw): add support for ClawHub tokens`).
// turbo
6. Commit the changes: `git commit -m "<commit_message>"`.
// turbo
7. Push the branch to origin: `git push -u origin <branch_name>`.
// turbo
8. Create a Pull Request using the GitHub CLI: `gh pr create --fill`.
