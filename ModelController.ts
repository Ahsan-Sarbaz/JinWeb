import type { Controller } from "./Controller";

export function isModelController<T>(controller: Controller | ModelController<T>): controller is ModelController<T> {
    return (controller as ModelController<T>).find !== undefined;
}

export interface ModelController<T> {
    find(key: any): T | undefined;
    index?(request: Request): Response;
    show?(request: Request, model: T): Response;
    create?(request: Request, model: T): Response;
    update?(request: Request, model: T): Response;
    delete?(request: Request, model: T): Response;
    patch?(request: Request, model: T): Response;
    options?(request: Request, model: T): Response;
}
