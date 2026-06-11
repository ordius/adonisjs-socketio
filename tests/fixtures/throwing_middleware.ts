export default class ThrowingMiddleware {
  async handle(_resolver: unknown, _context: unknown, _next: (error?: Error) => void) {
    throw new Error('middleware failed')
  }
}
