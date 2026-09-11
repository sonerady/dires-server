# V1 generation provider

Edit the `provider` cell on the `id = v1` row in Supabase table
`public.app_model_generation_config`:

| provider | V1 model | Automatic finishing |
| --- | --- | --- |
| `gpt` | `openai/gpt-image-2.5/sunburst/edit` | Pruna 4 MP; use original if finishing fails |
| `gemini` | `fal-ai/nano-banana-2/edit` | None |

The initial value is `gpt`. Only these two values are accepted. Dashboard/SQL
administrators can update it; anonymous and authenticated app users cannot read
or write it. The backend service role has SELECT access only.

Both active V7 routes read the setting once before a generation's provider retry
loop. The next generation sees the latest value without a server restart; active
jobs keep their snapshot. Missing/invalid data, a failed read or a 3-second read
timeout falls back to `gpt`, with a warning in server logs. The backend must have
`SUPABASE_SERVICE_KEY` or `SUPABASE_SERVICE_ROLE_KEY` configured.

Web and RN phone/tablet/Mac share these routes. V2, separate editing tools, model
portrait creation and variants are unaffected. Existing explicitly selected paid
higher-MP upgrades remain available; this switch controls the automatic 4 MP pass.
Sunburst content-checker fallback to NB2 also skips automatic finishing.

The database table is live; deployed backends start honoring it when the code
containing `services/modelCreationConfig.js` is deployed.
