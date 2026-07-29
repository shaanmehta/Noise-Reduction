"""Application errors that are safe to show to a visitor.

Anything raised as an AppError carries a message written for a person, not a
stack trace. Everything else is caught at the boundary and replaced with a
generic message, so internal paths and library internals never reach a client.
"""

from __future__ import annotations


class AppError(Exception):
    """Base class for errors with a presentable message."""

    status_code = 400

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class AudioError(AppError):
    """The uploaded audio could not be read or is unusable."""

    status_code = 415


class LimitError(AppError):
    """The request exceeded a configured limit."""

    status_code = 413


class RateLimitError(AppError):
    """Too many requests from one client."""

    status_code = 429


class SessionError(AppError):
    """The referenced upload is unknown or has expired."""

    status_code = 404


class ProcessingTimeout(AppError):
    """Processing exceeded the allotted time."""

    status_code = 504
