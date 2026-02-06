# API Reference v2

## Authentication

All API requests require authentication via Bearer token or API key.

```
Authorization: Bearer <your-token>
X-API-Key: <your-api-key>
```

Tokens expire after **1 hour**. API keys do not expire but can be revoked. Use the refresh endpoint to obtain a new token.

## Endpoints

### GET /users

Returns a paginated list of users. Supports filtering.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| page | integer | No | Page number (default: 1) |
| limit | integer | No | Items per page (default: 20, max: 100) |
| sort | string | No | Sort field (name, email, created_at) |
| filter | string | No | Filter expression (e.g., `role:admin`) |
| fields | string | No | Comma-separated fields to include |

**Response:**

```json
{
  "data": [
    {
      "id": 1,
      "name": "Alice",
      "email": "alice@example.com",
      "role": "admin",
      "created_at": "2024-01-15T10:00:00Z"
    }
  ],
  "meta": {
    "total": 100,
    "page": 1,
    "pages": 5
  }
}
```

### POST /users

Creates a new user. Requires admin role.

**Request body:**

```json
{
  "name": "Bob",
  "email": "bob@example.com",
  "role": "member",
  "team_id": 42
}
```

**Response:** Returns the created user with a 201 status code.

### PATCH /users/:id

Partially updates a user. Only provided fields are modified.

**Request body:**

```json
{
  "name": "Robert",
  "role": "admin"
}
```

**Response:** Returns the updated user.

### DELETE /users/:id

Deletes a user by ID. Requires admin role. This is a **soft delete** — the user is marked as inactive and can be restored within 30 days.

**Response:** Returns 204 No Content on success.

## Error Handling

All errors follow a consistent format:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found",
    "request_id": "abc-123"
  }
}
```

> Common error codes: `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `RATE_LIMITED`, `INTERNAL_ERROR`

## Rate Limiting

API requests are limited to **500 requests per minute** per token. When the limit is exceeded, the API returns a 429 status code with a `Retry-After` header.

Rate limit headers are included in every response:

```
X-RateLimit-Limit: 500
X-RateLimit-Remaining: 342
X-RateLimit-Reset: 1709312400
```

## Webhooks

You can register webhook URLs to receive real-time notifications for events:

- `user.created` — A new user was created
- `user.deleted` — A user was deleted
- `user.updated` — A user's profile was modified

Configure webhooks via `POST /webhooks` with a `url` and list of `events`.
