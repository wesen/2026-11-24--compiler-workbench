# Changelog

## 2026-11-26

- Created the ticket and put the Stage 1 design in review. The proposed synchronous native pass path shares candidate validation and write enforcement with Typed and uses the existing sampled differential checker. [Stage 1 design](./design-doc/01-tix-stage-1-design.md), [diary](./reference/01-diary.md)

## 2026-11-26

Incorporated the design review and moved Stage 1 into implementation.

## 2026-11-26

Implemented and checked the Tix parser, indexed artifact, evaluators, sampled meaning contract, checked passes, and six corpus programs. The framework change is the synchronous native pass entry point and shared candidate preparation.

## 2026-11-26

Added the publication report and recorded the independent evaluation of d25be76, which reported no failures or rejections.
