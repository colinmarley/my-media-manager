"""
A small in-memory stand-in for an async SQLAlchemy session.

It evaluates the subset of SQLAlchemy Core/ORM statements the inventory code
uses (select of an entity or of columns, ``where`` with ==, !=, IN, IS [NOT],
LIKE, AND/OR, JSONB ``->`` / ``->>``, ``order_by``, ``limit``; ``update`` and
``delete`` with ``where``) against plain ORM objects held in memory. It is not
a database: there are no transactions, and ``commit`` only counts.

Used by the unit tests that need more than a mocked ``execute`` without
starting Postgres.
"""

from __future__ import annotations

import operator as py_operator
import re
import uuid
from typing import Any, Dict, Iterable, List, Optional

from sqlalchemy.sql import operators
from sqlalchemy.sql.dml import Delete, Update
from sqlalchemy.sql.elements import (
    BinaryExpression,
    BindParameter,
    BooleanClauseList,
    Grouping,
    Label,
    Null,
    True_,
    False_,
    UnaryExpression,
)
from sqlalchemy.sql.selectable import Select


class _Missing:
    pass


_MISSING = _Missing()


def _like_to_regex(pattern: str, escape: Optional[str]) -> re.Pattern:
    out = []
    i = 0
    while i < len(pattern):
        ch = pattern[i]
        if escape and ch == escape and i + 1 < len(pattern):
            out.append(re.escape(pattern[i + 1]))
            i += 2
            continue
        if ch == "%":
            out.append(".*")
        elif ch == "_":
            out.append(".")
        else:
            out.append(re.escape(ch))
        i += 1
    return re.compile("^" + "".join(out) + "$", re.DOTALL)


class FakeResult:
    def __init__(self, rows: List[Any], scalar_rows: bool):
        self._rows = rows
        self._scalar_rows = scalar_rows
        self.rowcount = len(rows)

    # ``rows`` are entities (scalar_rows) or tuples of column values.
    def scalars(self):
        values = self._rows if self._scalar_rows else [row[0] for row in self._rows]
        return _Scalars(values)

    def scalar_one_or_none(self):
        values = self.scalars().all()
        if len(values) > 1:
            raise AssertionError("scalar_one_or_none() got more than one row")
        return values[0] if values else None

    def scalar(self):
        values = self.scalars().all()
        return values[0] if values else None

    def first(self):
        rows = self.all()
        return rows[0] if rows else None

    def all(self):
        if self._scalar_rows:
            return [(row,) for row in self._rows]
        return list(self._rows)


class _Scalars:
    def __init__(self, values):
        self._values = values

    def all(self):
        return list(self._values)

    def first(self):
        return self._values[0] if self._values else None


class _NoopTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class FakeSession:
    """In-memory async session. ``objects`` holds every stored ORM object."""

    def __init__(self, objects: Iterable[Any] = ()):
        self.objects: List[Any] = []
        self.commits = 0
        self.flushes = 0
        self.deleted: List[Any] = []
        for obj in objects:
            self.add(obj)

    # -- unit of work -----------------------------------------------------
    def add(self, obj: Any) -> None:
        if obj in self.objects:
            return
        if hasattr(type(obj), "__table__"):
            pk = type(obj).__table__.primary_key.columns.keys()
            if pk == ["id"] and not getattr(obj, "id", None):
                obj.id = str(uuid.uuid4())
        self.objects.append(obj)

    async def delete(self, obj: Any) -> None:
        if obj in self.objects:
            self.objects.remove(obj)
            self.deleted.append(obj)

    async def flush(self) -> None:
        self.flushes += 1
        self._check_unique()

    async def commit(self) -> None:
        self.commits += 1
        self._check_unique()

    async def rollback(self) -> None:
        pass

    def begin_nested(self):
        return _NoopTransaction()

    async def refresh(self, obj: Any) -> None:
        pass

    async def close(self) -> None:
        pass

    async def get(self, model: Any, key: Any) -> Any:
        for obj in self.objects:
            if isinstance(obj, model) and getattr(obj, "id", None) == key:
                return obj
        return None

    def _check_unique(self) -> None:
        # media_files.file_path is unique; catching a duplicate here keeps the
        # merge logic honest.
        seen: Dict[Any, Any] = {}
        for obj in self.objects:
            table = getattr(type(obj), "__tablename__", None)
            if table == "media_files":
                key = (table, obj.file_path)
                if key in seen:
                    raise AssertionError(f"duplicate media_files.file_path: {obj.file_path}")
                seen[key] = obj

    # -- context manager (also usable as its own session factory) ---------
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def __call__(self):
        return self

    # -- statements -------------------------------------------------------
    async def execute(self, statement: Any, *_args, **_kwargs) -> FakeResult:
        if isinstance(statement, Select):
            return self._select(statement)
        if isinstance(statement, Update):
            return self._update(statement)
        if isinstance(statement, Delete):
            return self._delete(statement)
        raise NotImplementedError(f"FakeSession cannot run {type(statement).__name__}")

    def _model_for_table(self, table) -> List[Any]:
        name = getattr(table, "name", None)
        return [obj for obj in self.objects if getattr(type(obj), "__tablename__", None) == name]

    def _select(self, stmt: Select) -> FakeResult:
        descriptions = stmt.column_descriptions
        entity = descriptions[0].get("entity")
        if entity is None:
            raise NotImplementedError("select without an entity")
        candidates = [obj for obj in self.objects if isinstance(obj, entity)]
        where = stmt.whereclause
        if where is not None:
            candidates = [obj for obj in candidates if _truthy(_eval(where, obj))]
        for clause in reversed(list(stmt._order_by_clauses)):
            reverse = False
            expr = clause
            if isinstance(clause, UnaryExpression):
                reverse = clause.modifier is operators.desc_op
                expr = clause.element
            candidates.sort(key=lambda obj, e=expr: _sort_key(_eval(e, obj)), reverse=reverse)
        limit = stmt._limit_clause
        if limit is not None:
            candidates = candidates[: int(limit.value)]

        whole_entity = len(descriptions) == 1 and descriptions[0].get("expr") is entity
        if whole_entity:
            return FakeResult(candidates, scalar_rows=True)
        columns = list(stmt.selected_columns)
        rows = [tuple(_eval(col, obj) for col in columns) for obj in candidates]
        return FakeResult(rows, scalar_rows=False)

    def _update(self, stmt: Update) -> FakeResult:
        targets = self._model_for_table(stmt.table)
        if stmt.whereclause is not None:
            targets = [obj for obj in targets if _truthy(_eval(stmt.whereclause, obj))]
        values = {col.key if hasattr(col, "key") else str(col): _eval(val, None) for col, val in stmt._values.items()}
        for obj in targets:
            for key, value in values.items():
                setattr(obj, key, value)
        return FakeResult(targets, scalar_rows=True)

    def _delete(self, stmt: Delete) -> FakeResult:
        targets = self._model_for_table(stmt.table)
        if stmt.whereclause is not None:
            targets = [obj for obj in targets if _truthy(_eval(stmt.whereclause, obj))]
        for obj in targets:
            self.objects.remove(obj)
            self.deleted.append(obj)
        return FakeResult(targets, scalar_rows=True)

    # -- helpers for tests ------------------------------------------------
    def all_of(self, model: Any) -> List[Any]:
        return [obj for obj in self.objects if isinstance(obj, model)]


def _sort_key(value: Any):
    return (value is None, value if value is not None else 0)


def _truthy(value: Any) -> bool:
    return bool(value) and value is not _MISSING


_COMPARISONS = {
    py_operator.eq: lambda a, b: a == b,
    py_operator.ne: lambda a, b: a != b,
    py_operator.lt: lambda a, b: a is not None and b is not None and a < b,
    py_operator.le: lambda a, b: a is not None and b is not None and a <= b,
    py_operator.gt: lambda a, b: a is not None and b is not None and a > b,
    py_operator.ge: lambda a, b: a is not None and b is not None and a >= b,
}


def _eval(expr: Any, obj: Any) -> Any:
    if isinstance(expr, Label):
        return _eval(expr.element, obj)
    if isinstance(expr, Grouping):
        return _eval(expr.element, obj)
    if isinstance(expr, BindParameter):
        return expr.effective_value
    if isinstance(expr, Null):
        return None
    if isinstance(expr, True_):
        return True
    if isinstance(expr, False_):
        return False
    if isinstance(expr, BooleanClauseList):
        values = [_eval(clause, obj) for clause in expr.clauses]
        if expr.operator is operators.and_:
            return all(_truthy(v) for v in values)
        if expr.operator is operators.or_:
            return any(_truthy(v) for v in values)
        raise NotImplementedError(f"boolean operator {expr.operator}")
    if isinstance(expr, BinaryExpression):
        op = expr.operator
        if op is operators.json_getitem_op:
            container = _eval(expr.left, obj)
            key = _eval(expr.right, obj)
            return container.get(key) if isinstance(container, dict) else None
        if isinstance(op, operators.custom_op) and op.opstring == "->>":
            container = _eval(expr.left, obj)
            key = _eval(expr.right, obj)
            value = container.get(key) if isinstance(container, dict) else None
            return None if value is None else str(value)
        left = _eval(expr.left, obj)
        if op is operators.is_:
            right = _eval(expr.right, obj)
            return left is right if right is None else left == right
        if op is operators.is_not:
            right = _eval(expr.right, obj)
            return left is not right if right is None else left != right
        if op is operators.in_op:
            right = _eval(expr.right, obj)
            return left in (right or [])
        if op is operators.not_in_op:
            right = _eval(expr.right, obj)
            return left not in (right or [])
        if op is operators.like_op or op is operators.not_like_op:
            right = _eval(expr.right, obj)
            matched = left is not None and bool(
                _like_to_regex(str(right), expr.modifiers.get("escape")).match(str(left))
            )
            return matched if op is operators.like_op else not matched
        if op in _COMPARISONS:
            right = _eval(expr.right, obj)
            if left is None or right is None:
                return False  # SQL NULL semantics
            return _COMPARISONS[op](left, right)
        raise NotImplementedError(f"operator {op}")
    # A column (Column / AnnotatedColumn / InstrumentedAttribute).
    key = getattr(expr, "key", None)
    if key is not None and obj is not None:
        return getattr(obj, key, None)
    raise NotImplementedError(f"cannot evaluate {type(expr).__name__}")
