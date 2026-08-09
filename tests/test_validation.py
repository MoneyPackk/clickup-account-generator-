"""Unit tests for src/security/validation.py."""

import pytest

from src.core.exceptions import ValidationError
from src.security.validation import AccountValidator, PasswordValidator
from src.core.config import PasswordSettings


def _password_settings(**kwargs) -> PasswordSettings:
    s = PasswordSettings()
    for k, v in kwargs.items():
        setattr(s, k, v)
    return s


@pytest.mark.unit
class TestPasswordValidator:
    def test_valid_password(self):
        s = _password_settings(min_length=8, max_length=64,
                                require_uppercase=True, require_lowercase=True,
                                require_digits=True, require_special=True,
                                special_chars="!@#")
        v = PasswordValidator(s)
        v.validate("Abcdef1!")  # should not raise

    def test_too_short(self):
        s = _password_settings(min_length=12, max_length=64,
                                require_uppercase=False, require_lowercase=False,
                                require_digits=False, require_special=False)
        v = PasswordValidator(s)
        with pytest.raises(ValidationError, match="at least 12"):
            v.validate("Short1!")

    def test_too_long(self):
        s = _password_settings(min_length=8, max_length=10,
                                require_uppercase=False, require_lowercase=False,
                                require_digits=False, require_special=False)
        v = PasswordValidator(s)
        with pytest.raises(ValidationError, match="not exceed"):
            v.validate("a" * 11)

    def test_missing_uppercase(self):
        s = _password_settings(min_length=8, max_length=64,
                                require_uppercase=True, require_lowercase=False,
                                require_digits=False, require_special=False)
        v = PasswordValidator(s)
        with pytest.raises(ValidationError, match="uppercase"):
            v.validate("alllowercase12!")

    def test_missing_digit(self):
        s = _password_settings(min_length=8, max_length=64,
                                require_uppercase=False, require_lowercase=False,
                                require_digits=True, require_special=False)
        v = PasswordValidator(s)
        with pytest.raises(ValidationError, match="digit"):
            v.validate("NoDigitsHere!")

    def test_missing_special(self):
        s = _password_settings(min_length=8, max_length=64,
                                require_uppercase=False, require_lowercase=False,
                                require_digits=False, require_special=True,
                                special_chars="!@#")
        v = PasswordValidator(s)
        with pytest.raises(ValidationError, match="special"):
            v.validate("NoSpecialChar1")

    def test_non_string_raises(self):
        v = PasswordValidator()
        with pytest.raises(ValidationError):
            v.validate(12345)  # type: ignore

    def test_generate_returns_valid_string(self):
        v = PasswordValidator()
        pwd = v.generate()
        assert isinstance(pwd, str)
        assert len(pwd) >= 16


@pytest.mark.unit
class TestAccountValidator:
    def test_valid_email(self):
        v = AccountValidator()
        v.validate_email("user@example.com")  # should not raise

    def test_invalid_email(self):
        v = AccountValidator()
        with pytest.raises(ValidationError, match="email"):
            v.validate_email("not-an-email")

    def test_empty_email(self):
        v = AccountValidator()
        with pytest.raises(ValidationError):
            v.validate_email("")

    def test_valid_username(self):
        v = AccountValidator()
        v.validate_username("user_123")  # should not raise

    def test_username_too_short(self):
        v = AccountValidator()
        with pytest.raises(ValidationError):
            v.validate_username("ab")

    def test_username_special_chars(self):
        v = AccountValidator()
        with pytest.raises(ValidationError):
            v.validate_username("user name!")

    def test_valid_domain(self):
        v = AccountValidator()
        v.validate_domain("example.com")  # should not raise

    def test_invalid_domain(self):
        v = AccountValidator()
        with pytest.raises(ValidationError):
            v.validate_domain("nodot")
