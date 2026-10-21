import {
  GraphQLError,
  Kind,
  type DocumentNode,
  type FragmentDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
} from "graphql";
import { badRequest } from "../errors";

// Limites de forma de una operacion GraphQL. Sin ellos un solo POST puede pedir
// cientos de resolutores (alias repetidos) o un arbol muy profundo, y cada
// resolutor cuenta como trabajo para la base y para el bloqueo de login.

export interface OperationLimits {
  /** Profundidad maxima del selection set (el campo raiz cuenta 1). */
  maxDepth: number;
  /** Campos raiz maximos por operacion, con sus alias. */
  maxRootFields: number;
  /** Veces maximas que puede repetirse el mismo campo raiz (por alias) en una operacion. */
  maxRepeatedRootField: number;
}

export const DEFAULT_LIMITS: OperationLimits = { maxDepth: 10, maxRootFields: 12, maxRepeatedRootField: 3 };

// Campos que cuestan caro o abren una puerta si se repiten: con un alias por
// intento se probaban 15 contrasenas en un solo request. Un login por pedido.
const SINGLE_USE_ROOT_FIELDS = new Set(["login", "changePassword"]);

function depthOf(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  visiting: Set<string>,
): number {
  let max = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (selection.name.value.startsWith("__")) continue;
      const below = selection.selectionSet ? depthOf(selection.selectionSet, fragments, visiting) : 0;
      max = Math.max(max, 1 + below);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      max = Math.max(max, depthOf(selection.selectionSet, fragments, visiting));
    } else {
      const name = selection.name.value;
      const fragment = fragments.get(name);
      if (!fragment || visiting.has(name)) continue; // el ciclo lo reporta la validacion estandar
      visiting.add(name);
      max = Math.max(max, depthOf(fragment.selectionSet, fragments, visiting));
      visiting.delete(name);
    }
  }
  return max;
}

function rootFields(
  selectionSet: SelectionSetNode,
  fragments: Map<string, FragmentDefinitionNode>,
  visiting: Set<string>,
  out: string[],
): void {
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      if (!selection.name.value.startsWith("__")) out.push(selection.name.value);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      rootFields(selection.selectionSet, fragments, visiting, out);
    } else {
      const name = selection.name.value;
      const fragment = fragments.get(name);
      if (!fragment || visiting.has(name)) continue;
      visiting.add(name);
      rootFields(fragment.selectionSet, fragments, visiting, out);
      visiting.delete(name);
    }
  }
}

/** Devuelve el primer incumplimiento de los limites, o `null` si el documento los respeta. */
export function checkLimits(document: DocumentNode, limits: OperationLimits = DEFAULT_LIMITS): string | null {
  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const def of document.definitions) {
    if (def.kind === Kind.FRAGMENT_DEFINITION) fragments.set(def.name.value, def);
  }
  for (const def of document.definitions) {
    if (def.kind !== Kind.OPERATION_DEFINITION) continue;
    const depth = depthOf(def.selectionSet, fragments, new Set());
    if (depth > limits.maxDepth) {
      return `La operación es demasiado profunda (${depth} niveles, máximo ${limits.maxDepth})`;
    }
    const names: string[] = [];
    rootFields(def.selectionSet, fragments, new Set(), names);
    if (names.length > limits.maxRootFields) {
      return `La operación pide demasiados campos en un solo request (${names.length}, máximo ${limits.maxRootFields})`;
    }
    const counts = new Map<string, number>();
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
    for (const [name, count] of counts) {
      const max = SINGLE_USE_ROOT_FIELDS.has(name) ? 1 : limits.maxRepeatedRootField;
      if (count > max) {
        return `El campo "${name}" no puede repetirse ${count} veces en un request (máximo ${max})`;
      }
    }
  }
  return null;
}

/** Regla de validacion de graphql-js: el error sale como BAD_REQUEST (400). */
export function operationLimitsRule(limits: OperationLimits = DEFAULT_LIMITS): ValidationRule {
  return (context: ValidationContext) => {
    const message = checkLimits(context.getDocument(), limits);
    if (message) {
      const error = badRequest(message);
      context.reportError(new GraphQLError(error.message, { extensions: error.extensions }));
    }
    return {};
  };
}
