#!/bin/sh
set -eu
node tools/attribute.mjs regex-nfa speed regexMatch --hot --input '{"pattern":{"string":"[a-c]*[b-d]*a*d"},"text":{"string":"abccabbd"}}'
