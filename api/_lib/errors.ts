export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public id?: string,
  ) {
    super(message);
  }
}
