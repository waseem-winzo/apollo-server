import {
  DocumentNode,
  FragmentDefinitionNode,
  GraphQLError,
  Kind,
  OperationDefinitionNode,
  print,
} from 'graphql';
import {
  QueryPlan,
  OperationContext,
} from './QueryPlan';
import { ComposedGraphQLSchema } from '@apollo/federation';
import { getQueryPlan } from '@apollo/query-planner-wasm';
import { WasmPointer } from '.';

export interface BuildQueryPlanOptions {
  autoFragmentization: boolean;
}

export function buildQueryPlan(
  operationContext: OperationContext,
  _options: BuildQueryPlanOptions = { autoFragmentization: false },
): QueryPlan {

  return getQueryPlan(
    operationContext.queryPlannerPointer,
    operationContext.operationString,
  );
}

// Adapted from buildExecutionContext in graphql-js
export function buildOperationContext(
  schema: ComposedGraphQLSchema,
  document: DocumentNode,
  queryPlannerPointer: WasmPointer,
  source: string,
  operationName?: string,
): OperationContext {
  let operation: OperationDefinitionNode | undefined;
  let operationCount: number = 0;
  const fragments: {
    [fragmentName: string]: FragmentDefinitionNode;
  } = Object.create(null);
  document.definitions.forEach(definition => {
    switch (definition.kind) {
      case Kind.OPERATION_DEFINITION:
        operationCount++;
        if (!operationName && operationCount > 1) {
          throw new GraphQLError(
            'Must provide operation name if query contains ' +
              'multiple operations.',
          );
        }
        if (
          !operationName ||
          (definition.name && definition.name.value === operationName)
        ) {
          operation = definition;
        }
        break;
      case Kind.FRAGMENT_DEFINITION:
        fragments[definition.name.value] = definition;
        break;
    }
  });
  if (!operation) {
    if (operationName) {
      throw new GraphQLError(`Unknown operation named "${operationName}".`);
    } else {
      throw new GraphQLError('Must provide an operation.');
    }
  }

  // In the case of multiple operations specified (operationName presence validated above),
  // `operation` === the operation specified by `operationName`
  const operationString = operationCount > 1
    ? print({
      kind: Kind.DOCUMENT,
      definitions: [
        operation,
        ...Object.values(fragments),
      ],
    })
    : source;

  return { schema, operation, fragments, queryPlannerPointer, operationString };
}
