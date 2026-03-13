# GitHub 发布检查清单

推送前确认这几项：

1. 真实配置只放在本地 `.env.local`，不要写进源码、README、docs。
2. `.gitignore` 已忽略 `.env.local`、`.env`、`.npmrc`、`node_modules`、`dist`、`.pnpm-store`。
3. 仓库里不包含具体模型名、内网地址、密钥、飞书 token、app secret。
4. 提交前先看一眼：

```bash
git status
git diff --cached
```

5. 如果要推到 GitHub，新建远端后执行：

```bash
git remote add origin <your-github-repo-url>
git push -u origin main
```

建议首次提交只包含：

- `src/`
- `docs/`
- `README.md`
- `.env.example`
- `.gitignore`
- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
