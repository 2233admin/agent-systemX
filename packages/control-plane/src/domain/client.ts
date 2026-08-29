export type ClientId = string & { readonly __clientId: unique symbol };

export function clientId(value: string): ClientId {
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new Error('client id must not be empty');
  return trimmed as ClientId;
}
