---
name: git-commit-author
description: "Set both author and committer before creating commits, or use filter-branch for both"
condition: ["git commit (?!--author|--amend)", "git commit --amend --author"]
scope: "tool:bash(*git*commit*)"
---

Before creating any commit, ensure the local git config has the correct user name and email: `git config user.name "..." && git config user.email "..."`. `git commit --amend --author=` only changes the author — the committer stays as whatever `user.name`/`user.email` in config. To fix both, use `git filter-branch --env-filter` or `git rebase --exec` with `--env` that sets both `GIT_AUTHOR_NAME`, `GIT_AUTHOR_EMAIL`, `GIT_COMMITTER_NAME`, and `GIT_COMMITTER_EMAIL`. Always verify with `git log --format="%h %an <%ae> | committer: %cn <%ce>"` before pushing.