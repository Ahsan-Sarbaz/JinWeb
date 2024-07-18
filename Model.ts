export abstract class Model {
    id!: number;
    abstract find (id: number): Model | undefined;
}
