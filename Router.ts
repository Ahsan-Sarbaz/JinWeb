import type { Controller } from "./Controller";
import { Model } from "./Model";
import { type ModelController } from "./ModelController";

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";

type Middleware = (
    request: Request,
    params: Record<string, string>,
    next: () => Promise<Response>
) => Promise<Response>;

class TrieNode {
    children: Map<string, TrieNode>;
    callback!: Function;
    pattern!: RegExp;
    paramName!: string;
    splatName!: string;
    middlewares: Middleware[] = [];

    constructor() {
        this.children = new Map();
    }

    use(middleware: Middleware) {
        this.middlewares.push(middleware);
    }
}

class RouteGroup {
    prefix: string;
    middlewares: Middleware[];
    router: Router;

    constructor(prefix: string, router: Router, middlewares: Middleware[] = []) {
        this.prefix = prefix.endsWith("/") ? prefix : prefix + "/";
        this.middlewares = middlewares;
        this.router = router;
    }

    addRoute(method: Method, path: string, callback: (request: Request, params: Record<string, any>) => Promise<Response>, middlewares: Middleware[] = []) {
        this.router.addRoute(method, this.prefix + path, callback, [...this.middlewares, ...middlewares]);
    }

    use(middleware: Middleware) {
        this.middlewares.push(middleware);
    }

    mapController(path: string, controller: Controller, middlewares: Middleware[] = []) {
        this.router.mapController(this.prefix + path, controller, [...this.middlewares, ...middlewares]);
    }

    mapModelController<T extends Model>(path: string, controller: ModelController<T>, middlewares: Middleware[] = []) {
        this.router.mapModelController(this.prefix + path, controller, [...this.middlewares, ...middlewares]);
    }
}

class Router {
    methods: Map<Method, TrieNode>;
    globalMiddlewares: Middleware[] = [];

    constructor() {
        this.methods = new Map();

        (["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as Method[]).forEach((method) => {
            this.methods.set(method, new TrieNode());
        });
    }

    use(middleware: Middleware) {
        this.globalMiddlewares.push(middleware);
    }

    addRoute(method: Method, path: string, callback: Function, middlewares: Middleware[] = []) {
        const root = this.methods.get(method)!;
        const segments = this.splitPath(path);

        let node = root;

        segments.forEach((segment) => {
            const paramMatch = segment.match(/^:(.+)/);
            const splatMatch = segment.match(/^\*(.+)/);

            if (paramMatch) {
                segment = ":param";
                if (!node.children.has(segment)) {
                    const paramNode = new TrieNode();
                    paramNode.paramName = paramMatch[1];
                    node.children.set(segment, paramNode);
                }
            } else if (splatMatch) {
                segment = "*splat";
                if (!node.children.has(segment)) {
                    const splatNode = new TrieNode();
                    splatNode.splatName = splatMatch[1];
                    node.children.set(segment, splatNode);
                }
            } else if (!node.children.has(segment)) {
                node.children.set(segment, new TrieNode());
            }

            node = node.children.get(segment)!;
        });

        node.callback = callback;
        node.pattern = this.createPattern(path);
        node.middlewares = middlewares; 
    }

    splitPath(path: string): string[] {
        const regex = /(\(.+?\))|(:[^/]+)|(\*[^/]+)|([^/]+)/g;
        return path.match(regex) || [];
    }

    createPattern(path: string): RegExp {
        const regexString = path
            .replace(/\/\(([^)]+)\)/g, "(?:/$1)?")
            .replace(/:\w+/g, "([^/]+)")
            .replace(/\*\w+/g, "(.+?)");
        return new RegExp("^" + regexString + "(?:\\?|$)");
    }

    get(path: string, callback: Function, middlewares: Middleware[] = []) {
        this.addRoute("GET", path, callback, middlewares);
    }

    post(path: string, callback: Function, middlewares: Middleware[] = []) {
        this.addRoute("POST", path, callback, middlewares);
    }

    put(path: string, callback: Function, middlewares: Middleware[] = []) {
        this.addRoute("PUT", path, callback, middlewares);
    }

    delete(path: string, callback: Function, middlewares: Middleware[] = []) {
        this.addRoute("DELETE", path, callback, middlewares);
    }

    patch(path: string, callback: Function, middlewares: Middleware[] = []) {
        this.addRoute("PATCH", path, callback, middlewares);
    }

    options(path: string, callback: Function, middlewares: Middleware[] = []) {
        this.addRoute("OPTIONS", path, callback, middlewares);
    }

    async route(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const pathname = url.pathname.split("/").filter(Boolean);
        const trie = this.methods.get(request.method.toUpperCase() as Method);

        if (!trie) {
            return this.send404();
        }

        let node = trie;
        const params: Record<string, any> = {};

        if (request.method === "GET") {
            const query = new URLSearchParams(url.search);
            for (const [key, value] of query) {
                params[key] = value;
            }
        } else {
            if (request.headers.get("Content-Type")?.startsWith("application/json")) {
                const body = await request.json();
                for (const [key, value] of Object.entries(body)) {
                    params[key] = value;
                }
            } else if (request.headers.get("Content-Type")?.startsWith("application/x-www-form-urlencoded")) {
                const body = new URLSearchParams(await request.text());
                for (const [key, value] of body) {
                    params[key] = value;
                }
            } else if (request.headers.get("Content-Type")?.startsWith("multipart/form-data")) {
                const body = await request.formData();
                body.forEach((value, key) => {
                    params[key] = value;
                });
            }
        }

        for (const segment of pathname) {
            if (node.children.has(segment)) {
                node = node.children.get(segment)!;
            } else if (node.children.has(":param")) {
                node = node.children.get(":param")!;
                params[node.paramName] = segment;
            } else if (node.children.has("*splat")) {
                node = node.children.get("*splat")!;
                params[node.splatName] = pathname.slice(pathname.indexOf(segment)).join("/");
                break;
            } else {
                return this.send404();
            }
        }

        const executeGlobalMiddlewares = async (index: number): Promise<Response> => {
            if (index >= this.globalMiddlewares.length) {
                return executeRouteMiddlewares(0);
            }
            const middleware = this.globalMiddlewares[index];
            return await middleware(request, params, () => executeGlobalMiddlewares(index + 1));
        };

        const executeRouteMiddlewares = async (index: number): Promise<Response> => {
            if (index >= node.middlewares.length) {
                return this.handleRoute(node, request, params);
            }
            const middleware = node.middlewares[index];
            return await middleware(request, params, () => executeRouteMiddlewares(index + 1));
        };

        return await executeGlobalMiddlewares(0);
    }

    async handleRoute(node: TrieNode, request: Request, params: Record<string, any>): Promise<Response> {
        if (node.callback) {
            return await node.callback(request, params);
        } else {
            return this.send404();
        }
    }

    send404(): Response {
        return new Response("Not found", { status: 404 });
    }

    group(prefix: string, middlewares: Middleware[] = [], callback: (group: RouteGroup) => void) {
        const group = new RouteGroup(prefix, this, middlewares);
        callback(group);
    }

    mapModelController<T extends Model>(path: string, controller: ModelController<T>, middlewares: Middleware[] = []) {
        if (controller.index) this.get(path, controller.index.bind(controller), middlewares);

        if (controller.show) {
            this.get(path + "/:id", async (request: Request, params: Record<string, string>) => {
                const model = controller.model.find(parseInt(params.id));
                if (model) {
                    return await controller.show!(request, model as T);
                } else {
                    return this.send404();
                }
            }, middlewares);
        }

        if (controller.create) {
            this.post(path, async (request: Request, params: Record<string, string>) => {
                if (request.headers.get("content-type") === "application/json") {
                    return await controller.create!(request, (await request.json()) as T);
                } else {
                    return new Response("Unsupported Media Type", { status: 415 });
                }
            }, middlewares);
        }
    }

    mapController(path: string, controller: Controller, middlewares: Middleware[] = []) {
        if (controller.index) this.get(path, controller.index.bind(controller), middlewares);
        if (controller.show) this.get(path + "/:id", controller.show.bind(controller), middlewares);
        if (controller.create) this.post(path, controller.create.bind(controller), middlewares);
        if (controller.update) this.put(path, controller.update.bind(controller), middlewares);
        if (controller.delete) this.delete(path, controller.delete.bind(controller), middlewares);
        if (controller.patch) this.patch(path, controller.patch.bind(controller)), middlewares;
        if (controller.options) this.options(path, controller.options.bind(controller), middlewares);
    }
}

export { Router };
