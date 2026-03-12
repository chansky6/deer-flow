# DeerFlow Frontend

Like the original DeerFlow 1.0, we would love to give the community a minimalistic and easy-to-use web interface with a more modern and flexible architecture.

## Tech Stack

- **Framework**: [Next.js 16](https://nextjs.org/) with [App Router](https://nextjs.org/docs/app)
- **UI**: [React 19](https://react.dev/), [Tailwind CSS 4](https://tailwindcss.com/), [Shadcn UI](https://ui.shadcn.com/), [MagicUI](https://magicui.design/) and [React Bits](https://reactbits.dev/)
- **AI Integration**: [LangGraph SDK](https://www.npmjs.com/package/@langchain/langgraph-sdk) and [Vercel AI Elements](https://vercel.com/ai-sdk/ai-elements)

## Quick Start

### Prerequisites

- Node.js 22+
- pnpm 10.26.2+

### Installation

```bash
# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env
# Edit .env with your configuration
```

### Development

```bash
# Start development server
pnpm dev

# The app will be available at http://localhost:3000
```

### Build

```bash
# Type check
pnpm typecheck

# Lint
pnpm lint

# Build for production
pnpm build

# Start production server
pnpm start
```

## Site Map

```
├── /                    # Landing page
├── /chats               # Chat list
├── /chats/new           # New chat page
└── /chats/[thread_id]   # A specific chat page
```

## Configuration

### Environment Variables

Key environment variables (see `.env.example` for full list):

```bash
# Frontend BFF target for Docker / server-side proxying
BACKEND_BASE_URL="http://gateway:8001"

# Required for OAuth login
AUTH_DATABASE_URL="postgresql://deerflow:change-me@localhost:5432/deerflow"
BETTER_AUTH_SECRET="replace-me"
INTERNAL_AUTH_JWT_SECRET="replace-me"

# Required for generic OIDC
OIDC_ISSUER="https://issuer.example.com"
OIDC_CLIENT_ID="your-oidc-client-id"
OIDC_CLIENT_SECRET="your-oidc-client-secret"

# Optional GitHub login
BETTER_AUTH_GITHUB_CLIENT_ID="your-github-client-id"
BETTER_AUTH_GITHUB_CLIENT_SECRET="your-github-client-secret"

# Optional Huawei W3 OAuth2 login (authorization_code only)
W3_OAUTH_CLIENT_ID="your-w3-client-id"
W3_OAUTH_CLIENT_SECRET="your-w3-client-secret"
W3_OAUTH_AUTHORIZATION_URL="https://w3.example.com/oauth2/authorize"
W3_OAUTH_TOKEN_URL="https://w3.example.com/oauth2/token"
W3_OAUTH_USERINFO_URL="https://w3.example.com/oauth2/userinfo"
# Optional
W3_OAUTH_SCOPES="profile,email"
W3_OAUTH_PKCE="true"
W3_OAUTH_USER_ID_FIELD="employee_id"
W3_OAUTH_USER_EMAIL_FIELD="mail"
W3_OAUTH_USER_NAME_FIELD="displayName"
W3_OAUTH_USER_IMAGE_FIELD="avatarUrl"
W3_OAUTH_USER_EMAIL_VERIFIED_FIELD="mailVerified"

# Optional direct overrides (normally unnecessary; the app defaults to /bff)
NEXT_PUBLIC_BACKEND_BASE_URL="http://localhost:8001"
NEXT_PUBLIC_LANGGRAPH_BASE_URL="http://localhost:2024"
```

W3 notes:
- The sign-in page always shows a Huawei W3 button.
- The button only starts OAuth when the five required W3 variables are all set.
- Profile mapping defaults to `id/sub`, `email`, `name/display_name`, `picture/avatar/avatar_url`, and `email_verified`.
- Use the `W3_OAUTH_USER_*_FIELD` overrides when W3 returns different field names.

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── api/                # API routes
│   ├── workspace/          # Main workspace pages
│   └── mock/               # Mock/demo pages
├── components/             # React components
│   ├── ui/                 # Reusable UI components
│   ├── workspace/          # Workspace-specific components
│   ├── landing/            # Landing page components
│   └── ai-elements/        # AI-related UI elements
├── core/                   # Core business logic
│   ├── api/                # API client & data fetching
│   ├── artifacts/          # Artifact management
│   ├── config/              # App configuration
│   ├── i18n/               # Internationalization
│   ├── mcp/                # MCP integration
│   ├── messages/           # Message handling
│   ├── models/             # Data models & types
│   ├── settings/           # User settings
│   ├── skills/             # Skills system
│   ├── threads/            # Thread management
│   ├── todos/              # Todo system
│   └── utils/              # Utility functions
├── hooks/                  # Custom React hooks
├── lib/                    # Shared libraries & utilities
├── server/                 # Server-side code (Not available yet)
│   └── better-auth/        # Authentication setup (Not available yet)
└── styles/                 # Global styles
```

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server with Turbopack |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server |
| `pnpm lint` | Run ESLint |
| `pnpm lint:fix` | Fix ESLint issues |
| `pnpm typecheck` | Run TypeScript type checking |
| `pnpm check` | Run both lint and typecheck |

## Development Notes

- Uses pnpm workspaces (see `packageManager` in package.json)
- Turbopack enabled by default in development for faster builds
- Environment validation can be skipped with `SKIP_ENV_VALIDATION=1` (useful for Docker)
- Backend API URLs are optional; nginx proxy is used by default in development

## License

MIT License. See [LICENSE](../LICENSE) for details.
