# Frontend Conventions (M3)

## Stack
React 19, Vite, TypeScript, Tailwind 4, shadcn/ui, TanStack Query, Recharts.

## Components
- Use the shadcn components in `src/components/ui/` (Card, Table, Dialog, Sheet, Tabs, Badge, ...). Do not hand-roll replacements.
- Use `HelpHint` (`src/components/help-hint.tsx`) next to any term a non-expert would not know.
- Shared components live in `src/components/`; page-specific code stays in its page file.

## Data fetching
- All API calls go through `api<T>()` in `src/lib/api.ts` (it adds the auth token and throws `ApiError`).
- Read with `useQuery`, write with `useMutation`, and invalidate the related `queryKey` afterwards.
- Types come from `src/lib/types.ts`, which mirrors the backend schemas. Change them only when the backend contract changes.

## Page states (every page needs all four)
- **Loading:** `Skeleton` placeholders shaped like the final content.
- **Empty:** a clear message plus the next action.
- **Error:** show the `ApiError` message in an `Alert`. 403 means read-only UI, 409 means show the server's `detail` text (gate or state error).
- **Data:** the normal view.

## Severity and status colors
- Use the CSS variables `--severity-critical|high|medium|low|info` in `index.css`. Do not hard-code colors.
- `ai_candidate` rows are always visibly marked as unconfirmed. Only `verified` counts as confirmed.

## Roles
- admin, assessor, viewer. Viewers get a read-only UI. Only admins edit LLM settings.

## Themes
- Check every change in both light and dark themes.

## Before every push
- `npm run build` passes.
- `git pull --rebase`, then stage files by name, then a Conventional Commit message.