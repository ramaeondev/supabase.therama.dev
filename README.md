# Supabase Edge Functions Collection

A collection of Supabase Edge Functions providing various API endpoints for different services.

## Available Functions

### Image Services
- **random-word-image**: Generates random words starting with a given letter and fetches related images from various sources
- **get-image-sources**: Returns available image source providers

### Project Management
- **get-projects**: Retrieves all projects
- **get-project-statuses**: Fetches project status definitions
- **update-project-version**: Updates project version and status
- **get-deployment-history**: Retrieves deployment history for projects
- **log-deployment**: Logs deployment events

### Communication
- **send-contact-email**: Handles contact form submissions via email
- **get-social-links**: Retrieves social media links

## Setup

1. Clone the repository
2. Install the Supabase CLI
3. Set up your environment variables in Supabase:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `RESEND_API_KEY` (for email service)
   - `PEXELS_API_KEY` (for image service)
   - `PIXABAY_API_KEY` (for image service)
   - `FLICKR_API_KEY` (for image service)

## Development

This project uses Deno for Edge Functions. The VS Code workspace is configured with the Deno extension for TypeScript support.

```bash
# Start Supabase locally
supabase start

# Deploy functions
supabase functions deploy
```

## CI/CD

The repository includes GitHub Actions workflows for:
- Automated deployments
- Version tracking
- Deployment logging

## License

MIT License - See [LICENSE](LICENSE) for details

## Author

Created by [Ramaeon](https://therama.dev)

## Version

Current version: 1.1.3
Status: Under Development