export const token = new URLSearchParams(location.search).get('token') ?? '';
export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new RequestError(data.error ?? 'The file service could not complete this request.', response.status);
  return data;
}
