import { GraphQLError } from 'graphql';
import gql from 'graphql-tag';
import { buildQueryPlan, buildOperationContext } from '../buildQueryPlan';
import { astSerializer, queryPlanSerializer } from '../snapshotSerializers';
import { getFederatedTestingSchema } from './execution-utils';
import { ComposedGraphQLSchema } from '@apollo/federation';
import { getQueryPlan, getQueryPlanner } from '@apollo/query-planner-wasm';
import { WasmPointer } from '..';

expect.addSnapshotSerializer(astSerializer);
expect.addSnapshotSerializer(queryPlanSerializer);

describe('buildQueryPlan', () => {
  let schema: ComposedGraphQLSchema;
  let errors: GraphQLError[];
  let queryPlannerPointer: WasmPointer;

  beforeEach(() => {
    ({ schema, errors, queryPlannerPointer } = getFederatedTestingSchema());
    expect(errors).toHaveLength(0);
  });

  it(`getQueryPlan`, () => {
    const csdl = `#graphql
      schema
        @graph(name: "test", url: "undefined")
        @composedGraph(version: 1)
      {
        query: Query
        mutation: Mutation
      }

      type Query {
        stuff: String @resolve(graph: "test")
      }
    `;

    const query = `#graphql
      query {
        stuff
      }
    `;

    const queryPlannerPointer = getQueryPlanner(csdl);

    const qp = getQueryPlan(queryPlannerPointer, query);
    expect(qp).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "test") {
          {
            stuff
          }
        },
      }
    `);
  });

  it(`should not confuse union types with overlapping field names`, () => {
    const queryString = `#graphql
      query {
          body {
            ... on Image {
              attributes {
                url
              }
            }
            ... on Text {
              attributes {
                bold
                text
              }
            }
          }
        }
    `;

    const queryDocument = gql(queryString);

    const queryPlan = buildQueryPlan(
      buildOperationContext(
        schema,
        queryDocument,
        queryPlannerPointer,
        queryString,
      ),
    );

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "documents") {
          {
            body {
              __typename
              ... on Image {
                attributes {
                  url
                }
              }
              ... on Text {
                attributes {
                  bold
                  text
                }
              }
            }
          }
        },
      }
    `);
  });

  it(`should use a single fetch when requesting a root field from one service`, () => {
    const queryString = `#graphql
      query {
        me {
          name
        }
      }
    `;

    const queryDocument = gql(queryString);

    const queryPlan = buildQueryPlan(
      buildOperationContext(
        schema,
        queryDocument,
        queryPlannerPointer,
        queryString,
      ),
    );

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "accounts") {
          {
            me {
              name
            }
          }
        },
      }
    `);
  });

  it(`should use two independent fetches when requesting root fields from two services`, () => {
    const queryString = `#graphql
      query {
        me {
          name
        }
      }
    `;

    const queryDocument = gql(queryString);

    const queryPlan = buildQueryPlan(
      buildOperationContext(
        schema,
        queryDocument,
        queryPlannerPointer,
        queryString,
      ),
    );

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Parallel {
          Fetch(service: "accounts") {
            {
              me {
                name
              }
            }
          },
          Sequence {
            Fetch(service: "product") {
              {
                topProducts {
                  __typename
                  ... on Book {
                    __typename
                    isbn
                  }
                  ... on Furniture {
                    name
                  }
                }
              }
            },
            Flatten(path: "topProducts.@") {
              Fetch(service: "books") {
                {
                  ... on Book {
                    __typename
                    isbn
                  }
                } =>
                {
                  ... on Book {
                    __typename
                    isbn
                    title
                    year
                  }
                }
              },
            },
            Flatten(path: "topProducts.@") {
              Fetch(service: "product") {
                {
                  ... on Book {
                    __typename
                    isbn
                    title
                    year
                  }
                } =>
                {
                  ... on Book {
                    name
                  }
                }
              },
            },
          },
        },
      }
    `);
  });

  it(`should use a single fetch when requesting multiple root fields from the same service`, () => {
    const queryString = `#graphql
      query {
        topProducts {
          name
        }
        product(upc: "1") {
          name
        }
      }
    `;

    const queryDocument = gql(queryString);

    const queryPlan = buildQueryPlan(
      buildOperationContext(
        schema,
        queryDocument,
        queryPlannerPointer,
        queryString,
      ),
    );

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Sequence {
          Fetch(service: "product") {
            {
              topProducts {
                __typename
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  name
                }
              }
              product(upc: "1") {
                __typename
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  name
                }
              }
            }
          },
          Parallel {
            Sequence {
              Flatten(path: "topProducts.@") {
                Fetch(service: "books") {
                  {
                    ... on Book {
                      __typename
                      isbn
                    }
                  } =>
                  {
                    ... on Book {
                      __typename
                      isbn
                      title
                      year
                    }
                  }
                },
              },
              Flatten(path: "topProducts.@") {
                Fetch(service: "product") {
                  {
                    ... on Book {
                      __typename
                      isbn
                      title
                      year
                    }
                  } =>
                  {
                    ... on Book {
                      name
                    }
                  }
                },
              },
            },
            Sequence {
              Flatten(path: "product") {
                Fetch(service: "books") {
                  {
                    ... on Book {
                      __typename
                      isbn
                    }
                  } =>
                  {
                    ... on Book {
                      __typename
                      isbn
                      title
                      year
                    }
                  }
                },
              },
              Flatten(path: "product") {
                Fetch(service: "product") {
                  {
                    ... on Book {
                      __typename
                      isbn
                      title
                      year
                    }
                  } =>
                  {
                    ... on Book {
                      name
                    }
                  }
                },
              },
            },
          },
        },
      }
    `);
  });

  it(`should use a single fetch when requesting relationship subfields from the same service`, () => {
    const queryString = `#graphql
      query {
        topReviews {
          body
          author {
            reviews {
              body
            }
          }
        }
      }
    `;

    const queryDocument = gql(queryString);

    const queryPlan = buildQueryPlan(
      buildOperationContext(
        schema,
        queryDocument,
        queryPlannerPointer,
        queryString,
      ),
    );

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "reviews") {
          {
            topReviews {
              body
              author {
                reviews {
                  body
                }
              }
            }
          }
        },
      }
    `);
  });

  it(`should use a single fetch when requesting relationship subfields and provided keys from the same service`, () => {
    const queryString = `#graphql
      query {
        topReviews {
          body
          author {
            id
            reviews {
              body
            }
          }
        }
      }
    `;

    const queryDocument = gql(queryString);

    const queryPlan = buildQueryPlan(
      buildOperationContext(
        schema,
        queryDocument,
        queryPlannerPointer,
        queryString,
      ),
    );

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "reviews") {
          {
            topReviews {
              body
              author {
                id
                reviews {
                  body
                }
              }
            }
          }
        },
      }
    `);
  });

  describe(`when requesting an extension field from another service`, () => {
    it(`should add the field's representation requirements to the parent selection set and use a dependent fetch`, () => {
      const queryString = `#graphql
        query {
          me {
            name
            reviews {
              body
            }
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "accounts") {
              {
                me {
                  name
                  __typename
                  id
                }
              }
            },
            Flatten(path: "me") {
              Fetch(service: "reviews") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    reviews {
                      body
                    }
                  }
                }
              },
            },
          },
        }
      `);
    });

    describe(`when the parent selection set is empty`, () => {
      it(`should add the field's requirements to the parent selection set and use a dependent fetch`, () => {
        const queryString = `#graphql
          query {
            me {
              reviews {
                body
              }
            }
          }
        `;

        const queryDocument = gql(queryString);

        const queryPlan = buildQueryPlan(
          buildOperationContext(
            schema,
            queryDocument,
            queryPlannerPointer,
            queryString,
          ),
        );

        expect(queryPlan).toMatchInlineSnapshot(`
          QueryPlan {
            Sequence {
              Fetch(service: "accounts") {
                {
                  me {
                    __typename
                    id
                  }
                }
              },
              Flatten(path: "me") {
                Fetch(service: "reviews") {
                  {
                    ... on User {
                      __typename
                      id
                    }
                  } =>
                  {
                    ... on User {
                      reviews {
                        body
                      }
                    }
                  }
                },
              },
            },
          }
        `);
      });
    });

    // TODO: Ask martijn about the meaning of this test
    it(`should only add requirements once`, () => {
      const queryString = `#graphql
        query {
          me {
            reviews {
              body
            }
            numberOfReviews
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "accounts") {
              {
                me {
                  __typename
                  id
                }
              }
            },
            Flatten(path: "me") {
              Fetch(service: "reviews") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    reviews {
                      body
                    }
                    numberOfReviews
                  }
                }
              },
            },
          },
        }
      `);
    });
  });

  describe(`when requesting a composite field with subfields from another service`, () => {
    it(`should add key fields to the parent selection set and use a dependent fetch`, () => {
       const queryString = `#graphql
        query {
          topReviews {
            body
            author {
              name
            }
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "reviews") {
              {
                topReviews {
                  body
                  author {
                    __typename
                    id
                  }
                }
              }
            },
            Flatten(path: "topReviews.@.author") {
              Fetch(service: "accounts") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    name
                  }
                }
              },
            },
          },
        }
      `);
    });

    describe(`when requesting a field defined in another service which requires a field in the base service`, () => {
      it(`should add the field provided by base service in first Fetch`, () => {
        const queryString = `#graphql
          query {
            topCars {
              retailPrice
            }
          }
        `;

        const queryDocument = gql(queryString);

        const queryPlan = buildQueryPlan(
          buildOperationContext(
            schema,
            queryDocument,
            queryPlannerPointer,
            queryString,
          ),
        );

        expect(queryPlan).toMatchInlineSnapshot(`
          QueryPlan {
            Sequence {
              Fetch(service: "product") {
                {
                  topCars {
                    __typename
                    id
                    price
                  }
                }
              },
              Flatten(path: "topCars.@") {
                Fetch(service: "reviews") {
                  {
                    ... on Car {
                      __typename
                      id
                      price
                    }
                  } =>
                  {
                    ... on Car {
                      retailPrice
                    }
                  }
                },
              },
            },
          }
        `);
      });
    });

    describe(`when the parent selection set is empty`, () => {
      it(`should add key fields to the parent selection set and use a dependent fetch`, () => {
        const queryString = `#graphql
          query {
            topReviews {
              author {
                name
              }
            }
          }
        `;

        const queryDocument = gql(queryString);

        const queryPlan = buildQueryPlan(
          buildOperationContext(
            schema,
            queryDocument,
            queryPlannerPointer,
            queryString,
          ),
        );

        expect(queryPlan).toMatchInlineSnapshot(`
          QueryPlan {
            Sequence {
              Fetch(service: "reviews") {
                {
                  topReviews {
                    author {
                      __typename
                      id
                    }
                  }
                }
              },
              Flatten(path: "topReviews.@.author") {
                Fetch(service: "accounts") {
                  {
                    ... on User {
                      __typename
                      id
                    }
                  } =>
                  {
                    ... on User {
                      name
                    }
                  }
                },
              },
            },
          }
        `);
      });
    });
  });
  describe(`when requesting a relationship field with extension subfields from a different service`, () => {
    it(`should first fetch the object using a key from the base service and then pass through the requirements`, () => {
      const queryString = `#graphql
        query {
          topReviews {
            author {
              birthDate
            }
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "reviews") {
              {
                topReviews {
                  author {
                    __typename
                    id
                  }
                }
              }
            },
            Flatten(path: "topReviews.@.author") {
              Fetch(service: "accounts") {
                {
                  ... on User {
                    __typename
                    id
                  }
                } =>
                {
                  ... on User {
                    birthDate
                  }
                }
              },
            },
          },
        }
      `);
    });
  });

  describe(`for abstract types`, () => {
    // GraphQLError: Cannot query field "isbn" on type "Book"
    // Probably an issue with extending / interfaces in composition. None of the fields from the base Book type
    // are showing up in the resulting schema.
    it(`should add __typename when fetching objects of an interface type from a service`, () => {
      const queryString = `#graphql
        query {
          topProducts {
            price
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Fetch(service: "product") {
            {
              topProducts {
                __typename
                ... on Book {
                  price
                }
                ... on Furniture {
                  price
                }
              }
            }
          },
        }
      `);
    });
  });

  // GraphQLError: Cannot query field "isbn" on type "Book"
  // Probably an issue with extending / interfaces in composition. None of the fields from the base Book type
  // are showing up in the resulting schema.
  it(`should break up when traversing an extension field on an interface type from a service`, () => {
    const queryString = `#graphql
      query {
        topProducts {
          price
          reviews {
            body
          }
        }
      }
    `;

    const queryDocument = gql(queryString);

    const queryPlan = buildQueryPlan(
      buildOperationContext(
        schema,
        queryDocument,
        queryPlannerPointer,
        queryString,
      ),
    );

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Sequence {
          Fetch(service: "product") {
            {
              topProducts {
                __typename
                ... on Book {
                  price
                  __typename
                  isbn
                }
                ... on Furniture {
                  price
                  __typename
                  upc
                }
              }
            }
          },
          Flatten(path: "topProducts.@") {
            Fetch(service: "reviews") {
              {
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  __typename
                  upc
                }
              } =>
              {
                ... on Book {
                  reviews {
                    body
                  }
                }
                ... on Furniture {
                  reviews {
                    body
                  }
                }
              }
            },
          },
        },
      }
    `);
  });

  it(`interface fragments should expand into possible types only`, () => {
    const queryString = `#graphql
      query {
        topReviews {
          body
          author {
            reviews {
              body
            }
          }
        }
      }
    `;

    const queryDocument = gql(queryString);

    const queryPlan = buildQueryPlan(
      buildOperationContext(
        schema,
        queryDocument,
        queryPlannerPointer,
        queryString,
      ),
    );

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Sequence {
          Fetch(service: "books") {
            {
              books {
                __typename
                isbn
                title
                year
              }
            }
          },
          Flatten(path: "books.@") {
            Fetch(service: "product") {
              {
                ... on Book {
                  __typename
                  isbn
                  title
                  year
                }
              } =>
              {
                ... on Book {
                  name
                }
              }
            },
          },
        },
      }
    `);
  });

  it(`interface inside interface should expand into possible types only`, () => {
    const queryString = `#graphql
      query {
        product(upc: "") {
          details {
            country
          }
        }
      }
    `;

    const queryDocument = gql(queryString);

    const queryPlan = buildQueryPlan(
      buildOperationContext(
        schema,
        queryDocument,
        queryPlannerPointer,
        queryString,
      ),
    );

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "product") {
          {
            product(upc: "") {
              __typename
              ... on Book {
                details {
                  country
                }
              }
              ... on Furniture {
                details {
                  country
                }
              }
            }
          }
        },
      }
    `);
  });

  xdescribe(`experimental compression to downstream services`, () => {
    it(`should generate fragments internally to downstream requests`, () => {
      const queryString = `#graphql
        query {
          topReviews {
            body
            author
            product {
              name
              price
              details {
                country
              }
            }
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
        { autoFragmentization: true },
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "reviews") {
              {
                topReviews {
                  ...__QueryPlanFragment_1__
                }
              }
              fragment __QueryPlanFragment_1__ on Review {
                body
                author
                product {
                  ...__QueryPlanFragment_0__
                }
              }
              fragment __QueryPlanFragment_0__ on Product {
                __typename
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  __typename
                  upc
                }
              }
            },
            Parallel {
              Sequence {
                Flatten(path: "topReviews.@.product") {
                  Fetch(service: "books") {
                    {
                      ... on Book {
                        __typename
                        isbn
                      }
                    } =>
                    {
                      ... on Book {
                        __typename
                        isbn
                        title
                        year
                      }
                    }
                  },
                },
                Flatten(path: "topReviews.@.product") {
                  Fetch(service: "product") {
                    {
                      ... on Book {
                        __typename
                        isbn
                        title
                        year
                      }
                    } =>
                    {
                      ... on Book {
                        name
                      }
                    }
                  },
                },
              },
              Flatten(path: "topReviews.@.product") {
                Fetch(service: "product") {
                  {
                    ... on Furniture {
                      __typename
                      upc
                    }
                    ... on Book {
                      __typename
                      isbn
                    }
                  } =>
                  {
                    ... on Furniture {
                      name
                      price
                      details {
                        country
                      }
                    }
                    ... on Book {
                      price
                      details {
                        country
                      }
                    }
                  }
                },
              },
            },
          },
        }
      `);
    });

    it(`shouldn't generate fragments for selection sets of length 2 or less`, () => {
      const queryString = `#graphql
        query {
          topReviews {
            body
            author
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
        { autoFragmentization: true },
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Fetch(service: "reviews") {
            {
              topReviews {
                body
                author
              }
            }
          },
        }
      `);
    });

    it(`should generate fragments for selection sets of length 3 or greater`, () => {
      const queryString = `#graphql
        query {
          topReviews {
            id
            body
            author
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
        { autoFragmentization: true },
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Fetch(service: "reviews") {
            {
              topReviews {
                ...__QueryPlanFragment_0__
              }
            }
            fragment __QueryPlanFragment_0__ on Review {
              id
              body
              author
            }
          },
        }
      `);
    });

    it(`should generate fragments correctly when aliases are used`, () => {
      const queryString = `#graphql
        query {
          reviews: topReviews {
            content: body
            author
            product {
              name
              cost: price
              details {
                origin: country
              }
            }
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
        { autoFragmentization: true },
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Sequence {
            Fetch(service: "reviews") {
              {
                reviews: topReviews {
                  ...__QueryPlanFragment_1__
                }
              }
              fragment __QueryPlanFragment_1__ on Review {
                content: body
                author
                product {
                  ...__QueryPlanFragment_0__
                }
              }
              fragment __QueryPlanFragment_0__ on Product {
                __typename
                ... on Book {
                  __typename
                  isbn
                }
                ... on Furniture {
                  __typename
                  upc
                }
              }
            },
            Parallel {
              Sequence {
                Flatten(path: "reviews.@.product") {
                  Fetch(service: "books") {
                    {
                      ... on Book {
                        __typename
                        isbn
                      }
                    } =>
                    {
                      ... on Book {
                        __typename
                        isbn
                        title
                        year
                      }
                    }
                  },
                },
                Flatten(path: "reviews.@.product") {
                  Fetch(service: "product") {
                    {
                      ... on Book {
                        __typename
                        isbn
                        title
                        year
                      }
                    } =>
                    {
                      ... on Book {
                        name
                      }
                    }
                  },
                },
              },
              Flatten(path: "reviews.@.product") {
                Fetch(service: "product") {
                  {
                    ... on Furniture {
                      __typename
                      upc
                    }
                    ... on Book {
                      __typename
                      isbn
                    }
                  } =>
                  {
                    ... on Furniture {
                      name
                      cost: price
                      details {
                        origin: country
                      }
                    }
                    ... on Book {
                      cost: price
                      details {
                        origin: country
                      }
                    }
                  }
                },
              },
            },
          },
        }
      `);
    });
  });

  it(`should properly expand nested unions with inline fragments`, () => {
    const queryString = `#graphql
      query {
        body {
          ... on Image {
            ... on Body {
              ... on Image {
                attributes {
                  url
                }
              }
              ... on Text {
                attributes {
                  bold
                  text
                }
              }
            }
          }
          ... on Text {
            attributes {
              bold
            }
          }
        }
      }
    `;

    const queryDocument = gql(queryString);

    const queryPlan = buildQueryPlan(
      buildOperationContext(
        schema,
        queryDocument,
        queryPlannerPointer,
        queryString,
      ),
    );

    expect(queryPlan).toMatchInlineSnapshot(`
      QueryPlan {
        Fetch(service: "documents") {
          {
            body {
              __typename
              ... on Image {
                attributes {
                  url
                }
              }
              ... on Text {
                attributes {
                  bold
                }
              }
            }
          }
        },
      }
    `);
  });

  describe('deduplicates fields / selections regardless of adjacency and type condition nesting', () => {
    it('for inline fragments', () => {
      const queryString = `#graphql
        query {
          body {
            ... on Image {
              ... on Text {
                attributes {
                  bold
                }
              }
            }
            ... on Body {
              ... on Text {
                attributes {
                  bold
                  text
                }
              }
            }
            ... on Text {
              attributes {
                bold
                text
              }
            }
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Fetch(service: "documents") {
            {
              body {
                __typename
                ... on Text {
                  attributes {
                    bold
                    text
                  }
                }
              }
            }
          },
        }
      `);
    });

    it('for named fragment spreads', () => {
      const queryString = `#graphql
        fragment TextFragment on Text {
          attributes {
            bold
            text
          }
        }

        query {
          body {
            ... on Image {
              ...TextFragment
            }
            ... on Body {
              ...TextFragment
            }
            ...TextFragment
          }
        }
      `;

      const queryDocument = gql(queryString);

      const queryPlan = buildQueryPlan(
        buildOperationContext(
          schema,
          queryDocument,
          queryPlannerPointer,
          queryString,
        ),
      );

      expect(queryPlan).toMatchInlineSnapshot(`
        QueryPlan {
          Fetch(service: "documents") {
            {
              body {
                __typename
                ... on Text {
                  attributes {
                    bold
                    text
                  }
                }
              }
            }
          },
        }
      `);
    });
  });
});
