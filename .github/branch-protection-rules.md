# Branch Protection Rules Configuration

This document describes the recommended branch protection rules for enterprise-grade CI/CD.

## Main Branch Protection

Go to: **Settings → Branches → Add branch protection rule**

### Branch name pattern: `main`

#### Protect matching branches

- [x] **Require a pull request before merging**
  - [x] Require approvals: **1** (minimum)
  - [x] Dismiss stale pull request approvals when new commits are pushed
  - [x] Require review from Code Owners
  - [x] Require approval of the most recent reviewable push

- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - Required status checks:
    - `Quality Gates`
    - `Unit Tests`
    - `Security Tests`
    - `Integration Tests`
    - `Build Validation`
    - `Performance Tests`
    - `Pipeline Status`
    - `Semgrep SAST Scan`
    - `CodeQL Analysis`
    - `Dependency Audit`
    - `Secret Scanning`
    - `Electron Security Audit`

- [x] **Require conversation resolution before merging**

- [x] **Require signed commits** (optional but recommended)

- [x] **Require linear history** (optional - enforces squash or rebase merges)

- [ ] **Include administrators** (optional - makes rules apply to admins too)

- [x] **Restrict who can push to matching branches**
  - Only allow merge via PR (no direct pushes)

- [x] **Do not allow bypassing the above settings**

---

## Development Branch Protection

### Branch name pattern: `development`

- [x] **Require a pull request before merging**
  - [x] Require approvals: **1**
  - [x] Dismiss stale pull request approvals when new commits are pushed

- [x] **Require status checks to pass before merging**
  - Required status checks:
    - `Quality Gates`
    - `Unit Tests`
    - `Security Tests`
    - `Build Validation`

- [x] **Require conversation resolution before merging**

---

## Feature Branch Rules

### Branch name pattern: `feature/*`

- No protection (developer branches)
- CI runs on PRs only

---

## Release Branch Protection

### Branch name pattern: `release/*`

- [x] **Require a pull request before merging**
  - [x] Require approvals: **2** (higher for releases)
  - [x] Require review from Code Owners

- [x] **Require status checks to pass before merging**
  - All status checks required

- [x] **Require signed commits**

---

## Rulesets (Alternative to Branch Protection)

GitHub Rulesets provide more granular control. Consider using rulesets for:

1. **Tag protection**: Prevent unauthorized version tagging
2. **Commit message format**: Enforce conventional commits
3. **File path restrictions**: Extra protection for sensitive files

---

## Required Actions Permissions

Ensure the following in **Settings → Actions → General**:

- [x] Allow GitHub Actions to create and approve pull requests: **OFF**
- [x] Workflow permissions: **Read repository contents and packages permissions**
- [x] Allow GitHub Actions to approve pull requests: **OFF**

---

## Secrets Required for CI/CD

Configure in **Settings → Secrets and variables → Actions**:

### Repository Secrets

| Secret | Description | Required For |
|--------|-------------|--------------|
| `WIN_CSC_LINK` | Windows code signing certificate (base64) | Signed releases |
| `WIN_CSC_KEY_PASSWORD` | Certificate password | Signed releases |
| `AWS_ACCESS_KEY_ID` | AWS access key for S3 | Auto-update deployment |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key | Auto-update deployment |
| `AWS_REGION` | AWS region (default: us-east-1) | Auto-update deployment |
| `S3_BUCKET` | S3 bucket name for releases | Auto-update deployment |

### Environment Secrets (for production)

Create a `production` environment with:
- Required reviewers
- Wait timer (optional)
- Deployment branch restrictions

---

## Verification Checklist

After configuring:

1. [ ] Test PR to main requires all status checks
2. [ ] Test direct push to main is blocked
3. [ ] Test PR requires code review approval
4. [ ] Test stale approval is dismissed on new commits
5. [ ] Test CODEOWNERS are automatically requested for review
6. [ ] Verify security scanning runs on all PRs
7. [ ] Verify release workflow requires tag or manual trigger
