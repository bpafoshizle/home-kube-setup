---
description: Pull latest changes from main and clean up the local feature branch after a PR merge.
---

1. Identify the name of the feature branch that was merged.
// turbo
2. Switch to the main branch: `git checkout main`.
// turbo
3. Pull the latest changes from origin: `git pull origin main`.
// turbo
4. Delete the local feature branch: `git branch -d <branch_name>`.
5. Verify the local repository is clean and reflects the latest remote state.
