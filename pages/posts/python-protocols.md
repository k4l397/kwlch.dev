---
title: Type-Safe Pagination in Python with Protocols
date: 2026-04-18
---

I wanted a generic pagination function for a GraphQL API, but the generated types wouldn't let me write one. I was using ariadne-codegen to generate typed Python stubs from a GraphQL schema — the types are correct, but you can't fully control their shape.

Each endpoint returned a discriminated union — a type that could be one of several unrelated types. For one endpoint, that looked like this:

```python
type EndpointAResult = EndpointASuccessItems | EndpointAAuthorizationError | EndpointANotFoundError

@dataclass
class EndpointASuccessItems:
    items: list[EndpointASuccessType]
    page_info: EndpointAPageInfo
```

The challenge was that each error type was a distinct class with no common base class. Without a shared parent, there's no obvious way to write an `isinstance` check in a generic function that a type checker can use to narrow the type.

This is the problem structural subtyping solves. Since Python 3.8, [Protocols](https://peps.python.org/pep-0544/) let you define a type by what it has, not what it inherits from. For me, having spent most time writing Go, this is a familiar concept very much akin to interfaces.

All the generated error types shared the same fields, but had no common parent:

```python
@dataclass
class EndpointAAuthorizationError:
    error_code: str
    error_message: str
```

And similarly, every paged response had the same pagination structure:

```python
@dataclass
class EndpointAPageInfo:
    has_next_page: bool
    end_cursor: str | None
```

So I defined Protocols that captured these shared shapes:

```python
@runtime_checkable
class ErrorResponse(Protocol):
    @property
    def error_code(self) -> str: ...
    @property
    def error_message(self) -> str: ...

class PageInfo(Protocol):
    @property
    def has_next_page(self) -> bool: ...
    @property
    def end_cursor(self) -> str | None: ...

class PagedResult[T](Protocol):
    @property
    def page_info(self) -> PageInfo: ...
    @property
    def items(self) -> list[T]: ...
```

By default, Protocols are a purely static concept — your type checker understands them, but `isinstance` doesn't. Adding `@runtime_checkable` lets you use `isinstance(result, ErrorResponse)` at runtime, which is what makes narrowing possible.

With those Protocols in place, the generic pagination function is now possible:

```python
_DEFAULT_PAGE_SIZE = 100

def paginate[T](
    fetch: Callable[[int, str | None], PagedResult[T] | ErrorResponse],
    page_size: int = _DEFAULT_PAGE_SIZE,
) -> Iterator[T]:
    after: str | None = None
    while True:
        result = fetch(page_size, after)
        if isinstance(result, ErrorResponse):
            raise APIError(f"Query failed [{result.error_code}]: {result.error_message}")
        yield from result.items
        if not result.page_info.has_next_page:
            break
        after = result.page_info.end_cursor
```

This handles pagination for any endpoint whose response matches the Protocol and the type checker correctly narrows `result` to `PagedResult[T]` after the `isinstance` check. Aside from being a useful static safety check, it also gives us useful autocompletion in our editor.

Calling it is straightforward:

```python
for item in paginate(lambda first, after: client.get_items(first=first, after=after)):
    print(item)
```

Python's type system still has gaps that are hard to ignore if you've spent time with TypeScript. Protocols are a potentially underused feature. Any time you're working with codegen output, third-party libraries, or multiple classes that happen to share a structure, Protocols let you write generic, type-safe code without reaching for inheritance or wrapper classes.
