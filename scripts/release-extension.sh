#!/usr/bin/env bash
set -e

VERSION=${1:?'Uso: ./scripts/release-extension.sh v1.0.2 "Descripcion"'}
NOTES=${2:-"Nueva versión"}
ZIP="apps/extension/cinema-extension.zip"
FILES=(apps/web/src/app/page.tsx apps/web/src/app/install/page.tsx)
MANIFEST="apps/extension/manifest.json"
EXT_PKG="apps/extension/package.json"
SEMVER="${VERSION#v}"  # manifest.json requires numeric version, no "v" prefix

# Detecta versión anterior del link
PREV=$(grep -o 'download/v[^/]*' "${FILES[0]}" | head -1 | cut -d/ -f2)

echo "→ Bump manifest a $SEMVER..."
sed -i "s/\"version\": \"[^\"]*\"/\"version\": \"$SEMVER\"/" "$MANIFEST" "$EXT_PKG"

echo "→ Build..."
pnpm --filter extension build

echo "→ GitHub release $VERSION..."
gh release create "$VERSION" "$ZIP" \
  --repo Jdvd01/creiai-cinema \
  --title "$VERSION" \
  --notes "$NOTES"

echo "→ Actualizar links ($PREV → $VERSION)..."
for f in "${FILES[@]}"; do
  sed -i "s|/download/$PREV/|/download/$VERSION/|g" "$f"
done

echo "→ Commit y push..."
git add "$MANIFEST" "$EXT_PKG" "${FILES[@]}"
git commit -m "chore(release): bump extension to $VERSION"
git push

echo ""
echo "✅ Listo — $VERSION publicado"
echo "   ZIP:  https://github.com/Jdvd01/creiai-cinema/releases/download/$VERSION/cinema-extension.zip"
echo "   Release: https://github.com/Jdvd01/creiai-cinema/releases/tag/$VERSION"
