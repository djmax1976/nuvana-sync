#!/bin/bash
# ============================================================================
# Nuvana Release Script
#
# Automates the release process:
# 1. Version bump
# 2. Run tests and type checking
# 3. Build and sign
# 4. Upload to S3
# 5. Git tag creation
#
# Usage: ./scripts/release.sh <version>
# Example: ./scripts/release.sh 1.0.1
#
# Environment Variables (for S3 upload):
# - AWS_ACCESS_KEY_ID
# - AWS_SECRET_ACCESS_KEY
# - UPDATE_BUCKET (default: nuvana-updates)
# - UPDATE_REGION (default: us-east-1)
#
# @module scripts/release
# ============================================================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
  exit 1
}

# Check for version argument
VERSION=$1
if [ -z "$VERSION" ]; then
  echo "Usage: ./scripts/release.sh <version>"
  echo "Example: ./scripts/release.sh 1.0.1"
  exit 1
fi

# Validate version format (semver)
if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  log_error "Invalid version format. Use semantic versioning (e.g., 1.0.1)"
fi

log_info "Starting release process for version $VERSION"
log_info "============================================="

# ============================================================================
# Step 1: Pre-flight checks
# ============================================================================
log_info "Running pre-flight checks..."

# Check for uncommitted changes
if [ -n "$(git status --porcelain)" ]; then
  log_warn "You have uncommitted changes. Please commit or stash them first."
  git status --short
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Check we're on the main/master branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [[ "$BRANCH" != "main" && "$BRANCH" != "master" && "$BRANCH" != "development" ]]; then
  log_warn "You are on branch '$BRANCH', not main/master/development"
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

log_success "Pre-flight checks passed"

# ============================================================================
# Step 2: Update version
# ============================================================================
log_info "Updating version to $VERSION..."

npm version $VERSION --no-git-tag-version

log_success "Version updated to $VERSION"

# ============================================================================
# Step 3: Run tests and checks
# ============================================================================
log_info "Running type checking..."
npm run typecheck || log_error "Type checking failed"
log_success "Type checking passed"

log_info "Running linting..."
npm run lint || log_error "Linting failed"
log_success "Linting passed"

log_info "Running tests..."
npm run test:run || log_error "Tests failed"
log_success "Tests passed"

log_info "Running security audit..."
npm audit --production || log_warn "Security audit has warnings (non-blocking)"
log_success "Security audit complete"

# ============================================================================
# Step 4: Build
# ============================================================================
log_info "Building application..."
npm run build:win || log_error "Build failed"
log_success "Build complete"

# ============================================================================
# Step 5: Verify build artifacts
# ============================================================================
log_info "Verifying build artifacts..."

INSTALLER_PATH="release/Nuvana-Setup-${VERSION}.exe"
if [ ! -f "$INSTALLER_PATH" ]; then
  log_error "Installer not found at $INSTALLER_PATH"
fi

INSTALLER_SIZE=$(stat -f%z "$INSTALLER_PATH" 2>/dev/null || stat -c%s "$INSTALLER_PATH")
log_info "Installer size: $(echo "scale=2; $INSTALLER_SIZE / 1048576" | bc) MB"

log_success "Build artifacts verified"

# ============================================================================
# Step 6: Upload to S3 (optional)
# ============================================================================
UPDATE_BUCKET="${UPDATE_BUCKET:-nuvana-updates}"
UPDATE_REGION="${UPDATE_REGION:-us-east-1}"

if [ -n "$AWS_ACCESS_KEY_ID" ] && [ -n "$AWS_SECRET_ACCESS_KEY" ]; then
  log_info "Uploading to S3..."

  aws s3 cp "release/Nuvana-Setup-${VERSION}.exe" "s3://${UPDATE_BUCKET}/releases/" --region "$UPDATE_REGION"
  aws s3 cp "release/Nuvana-Setup-${VERSION}.exe.blockmap" "s3://${UPDATE_BUCKET}/releases/" --region "$UPDATE_REGION" 2>/dev/null || true
  aws s3 cp "release/latest.yml" "s3://${UPDATE_BUCKET}/releases/" --region "$UPDATE_REGION"

  log_success "Uploaded to S3"
else
  log_warn "AWS credentials not set - skipping S3 upload"
  log_info "Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to enable S3 upload"
fi

# ============================================================================
# Step 7: Git commit and tag
# ============================================================================
log_info "Creating git commit and tag..."

git add package.json package-lock.json
git commit -m "Release v${VERSION}

- Version bump to ${VERSION}
- Built and tested successfully

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"

git tag -a "v${VERSION}" -m "Release v${VERSION}"

log_success "Git commit and tag created"

# ============================================================================
# Step 8: Push to remote (optional)
# ============================================================================
read -p "Push to remote? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  git push origin "$BRANCH"
  git push origin "v${VERSION}"
  log_success "Pushed to remote"
else
  log_info "Skipping push. To push later, run:"
  echo "  git push origin $BRANCH"
  echo "  git push origin v${VERSION}"
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
log_success "============================================="
log_success "Release $VERSION complete!"
log_success "============================================="
echo ""
log_info "Artifacts:"
echo "  - Installer: release/Nuvana-Setup-${VERSION}.exe"
echo "  - Git tag: v${VERSION}"
if [ -n "$AWS_ACCESS_KEY_ID" ]; then
  echo "  - S3: s3://${UPDATE_BUCKET}/releases/"
fi
echo ""
log_info "Next steps:"
echo "  1. Test the installer on a clean machine"
echo "  2. Verify auto-update from previous version"
echo "  3. Create GitHub release (if applicable)"
echo "  4. Update CHANGELOG.md"
echo ""
