
import type { Controller } from "./Controller";
import { isModelController, type ModelController } from "./ModelController";

class TrieNode {
    children: Map<string, TrieNode>;
    callback!: Function;
    pattern!: RegExp;
    paramName!: string;
    splatName!: string;

    constructor() {
        this.children = new Map();
    }
}

type Method = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS";

class Router {
    methods: Map<Method, TrieNode>;
    constructor() {
        this.methods = new Map();

        (["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as Method[]).forEach((method) => {
            this.methods.set(method, new TrieNode());
        });
    }

    addRoute(method: Method, path: string, callback: Function) {
        const root = this.methods.get(method);
        if (!root) {
            return;
        }

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
    }

    splitPath(path: string) {
        const regex = /(\(.+?\))|(:[^/]+)|(\*[^/]+)|([^/]+)/g;
        return path.match(regex) || [];
    }

    createPattern(path: string) {
        const regexString = path
            .replace(/\/\(([^)]+)\)/g, "(?:/$1)?")
            .replace(/:\w+/g, "([^/]+)")
            .replace(/\*\w+/g, "(.+?)");
        return new RegExp("^" + regexString + "(?:\\?|$)");
    }

    get(path: string, callback: Function) {
        this.addRoute("GET", path, callback);
    }

    post(path: string, callback: Function) {
        this.addRoute("POST", path, callback);
    }

    put(path: string, callback: Function) {
        this.addRoute("PUT", path, callback);
    }

    delete(path: string, callback: Function) {
        this.addRoute("DELETE", path, callback);
    }

    patch(path: string, callback: Function) {
        this.addRoute("PATCH", path, callback);
    }

    options(path: string, callback: Function) {
        this.addRoute("OPTIONS", path, callback);
    }

    async route(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const pathname = url.pathname.split("/").filter(Boolean);
        const trie = this.methods.get(request.method.toUpperCase() as Method);

        if (!trie) {
            return this.send404();
        }

        let node = trie;
        const params: Record<string, string> = {};

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

        if (node.callback) {
            return await node.callback(request, params);
        } else {
            return this.send404();
        }
    }

    send404(): Response {
        return new Response("Not found", { status: 404 });
    }

    map<T>(path: string, controller: Controller | ModelController<T>) {
        if (controller.index) this.get(path, controller.index.bind(controller));

        if (isModelController(controller) && controller.find && controller.show) {
            this.get(path + "/:id", async (request: Request, params: Record<string, string>) => {
                const model = controller.find(parseInt(params.id));
                if (model) {
                    return await controller.show!(request, model);
                } else {
                    return this.send404();
                }
            });
        } else if (controller.show) {
            this.get(path + "/:id", controller.show.bind(controller));
        }

        if (controller.create) this.post(path, controller.create.bind(controller));
        if (controller.update) this.put(path, controller.update.bind(controller));
        if (controller.delete) this.delete(path, controller.delete.bind(controller));
        if (controller.patch) this.patch(path, controller.patch.bind(controller));
        if (controller.options) this.options(path, controller.options.bind(controller));
    }
}


export { Router };