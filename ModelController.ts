import type { Controller } from "./Controller";
import type { Model } from "./Model";

export interface ModelController<T extends Model> {
    model: T;
    index?(request: Request): Response;
    show?(request: Request, model: T): Response;
    create?(request: Request, model: T): Response;
    update?(request: Request, model: T): Response;
    delete?(request: Request, model: T): Response;
    patch?(request: Request, model: T): Response;
    options?(request: Request, model: T): Response;
}
