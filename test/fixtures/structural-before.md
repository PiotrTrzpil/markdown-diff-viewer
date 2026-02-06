# API Reference

## Authentication

All API requests require a Bearer token in the Authorization header.

```
Authorization: Bearer <your-token>
```

Tokens expire after 24 hours. Use the refresh endpoint to obtain a new token.

## Endpoints

### GET /users

Returns a list of all users.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| page | integer | No | Page number (default: 1) |
| limit | integer | No | Items per page (default: 20) |
| sort | string | No | Sort field (name, email, created_at) |

**Response:**

```json
{
  "users": [
    {
      "id": 1,
      "name": "Alice",
      "email": "alice@example.com"
    }
  ],
  "total": 100,
  "page": 1
}
```

### POST /users

Creates a new user.

**Request body:**

```json
{
  "name": "Bob",
  "email": "bob@example.com",
  "role": "member"
}
```

**Response:** Returns the created user with a 201 status code.

### DELETE /users/:id

Deletes a user by ID. Requires admin role.

**Response:** Returns 204 No Content on success.

## Error Handling

All errors follow a consistent format:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "User not found"
  }
}
```

## Rate Limiting

API requests are limited to 100 requests per minute per token. When the limit is exceeded, the API returns a 429 status code with a `Retry-After` header.
