#!/bin/sh
# Protocol-conforming smoke-test decoder: no candidates forces piecemeal edits.
while IFS= read -r request; do
  printf '[]\n'
done
