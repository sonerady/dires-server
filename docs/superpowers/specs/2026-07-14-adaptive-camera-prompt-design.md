# Adaptive camera prompt direction

## Goal

Prevent the prompt enhancer from treating a small set of studio-camera examples as the default visual recipe, while preserving a concrete, professional photography direction.

## Scope

Update only the normal-mode `Paragraph 4 → Photography, Light & Grade` instruction in `src/routes/referenceBrowserRoutesV7.js`.

## Behavior

- Keep the existing user-selected framing and perspective behavior unchanged.
- Remove the fixed examples: three-point softbox, 85mm f/2.8, clean high-key commercial grade, and medium-format film with fine grain.
- Require the enhancer to select camera character, viewpoint, depth of field, lighting, and color treatment from the specific garment, pose, model, and location.
- Explicitly tell the enhancer not to make any lens, lighting setup, or grade its repeated default.

## Validation

Add a focused regression check that verifies the prompt instruction contains the adaptive direction and no longer contains the removed fixed recipes.
