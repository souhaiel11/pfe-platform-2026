#!/usr/bin/env bash
# Installation des git hooks
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOKS_DIR="$REPO_ROOT/.git/hooks"
SRC_DIR="$REPO_ROOT/scripts/git-hooks"

if [ ! -d "$HOOKS_DIR" ]; then
    echo "Dépôt Git non initialisé. Exécutez 'git init' d'abord."
    exit 1
fi

cp "$SRC_DIR/pre-commit" "$HOOKS_DIR/pre-commit"
chmod +x "$HOOKS_DIR/pre-commit"
echo "✔ Hook pre-commit installé dans $HOOKS_DIR"
