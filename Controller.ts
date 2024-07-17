export interface Controller {
    index?(request: Request, params: Record<string, string>): Response;
    show?(request: Request, params: Record<string, string>): Response;
    create?(request: Request, params: Record<string, string>): Response;
    update?(request: Request, params: Record<string, string>): Response;
    delete?(request: Request, params: Record<string, string>): Response;
    patch?(request: Request, params: Record<string, string>): Response;
    options?(request: Request, params: Record<string, string>): Response;
}
