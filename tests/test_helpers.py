"""Unit tests for src/utils/helpers.py."""

import re
import string

import pytest

from src.utils.helpers import (
    generate_password,
    generate_username,
    is_valid_domain,
    mask_email,
    sanitize_input,
)


@pytest.mark.unit
class TestGenerateUsername:
    def test_has_prefix(self):
        name = generate_username(prefix="clickup")
        assert name.startswith("clickup_")

    def test_default_length(self):
        # prefix="user", length=10  =>  "user_" + 10 chars
        name = generate_username()
        assert len(name) == len("user_") + 10

    def test_custom_length(self):
        name = generate_username(prefix="x", length=5)
        assert len(name) == len("x_") + 5

    def test_suffix_alphanumeric(self):
        name = generate_username(prefix="p", length=20)
        suffix = name.split("_", 1)[1]
        allowed = set(string.ascii_lowercase + string.digits)
        assert all(c in allowed for c in suffix)

    def test_different_each_call(self):
        names = {generate_username() for _ in range(20)}
        assert len(names) > 1


@pytest.mark.unit
class TestGeneratePassword:
    def test_meets_minimum_length(self):
        pwd = generate_password(min_length=16, max_length=16)
        assert len(pwd) == 16

    def test_within_length_range(self):
        for _ in range(50):
            pwd = generate_password(min_length=12, max_length=20)
            assert 12 <= len(pwd) <= 20

    def test_has_uppercase(self):
        pwd = generate_password(require_uppercase=True, require_lowercase=False,
                                require_digits=False, require_special=False)
        assert any(c.isupper() for c in pwd)

    def test_has_lowercase(self):
        pwd = generate_password(require_uppercase=False, require_lowercase=True,
                                require_digits=False, require_special=False)
        assert any(c.islower() for c in pwd)

    def test_has_digit(self):
        pwd = generate_password(require_uppercase=False, require_lowercase=False,
                                require_digits=True, require_special=False)
        assert any(c.isdigit() for c in pwd)

    def test_has_special(self):
        special = "!@#"
        pwd = generate_password(require_uppercase=False, require_lowercase=False,
                                require_digits=False, require_special=True,
                                special_chars=special)
        assert any(c in special for c in pwd)

    def test_all_requirements_at_once(self):
        pwd = generate_password()
        assert any(c.isupper() for c in pwd)
        assert any(c.islower() for c in pwd)
        assert any(c.isdigit() for c in pwd)
        assert any(c in "!@#$%^&*()_+-=[]{}|;:,.<>?" for c in pwd)

    def test_raises_on_bad_params(self):
        with pytest.raises(ValueError):
            generate_password(min_length=4)  # below 8
        with pytest.raises(ValueError):
            generate_password(min_length=20, max_length=10)  # max < min


@pytest.mark.unit
class TestMaskEmail:
    def test_masks_local_part(self):
        assert mask_email("alice@example.com") == "a***e@example.com"

    def test_short_local_part(self):
        assert mask_email("ab@example.com") == "***@example.com"

    def test_no_at_sign(self):
        assert mask_email("notanemail") == "***"

    def test_single_char_local(self):
        assert mask_email("a@x.com") == "***@x.com"

    def test_domain_preserved(self):
        result = mask_email("longname@mydomain.io")
        assert result.endswith("@mydomain.io")


@pytest.mark.unit
class TestSanitizeInput:
    def test_strips_html_chars(self):
        assert "<" not in sanitize_input("<script>alert(1)</script>")
        assert ">" not in sanitize_input("<script>alert(1)</script>")

    def test_strips_newlines(self):
        result = sanitize_input("line1\nline2\r\nline3")
        assert "\n" not in result
        assert "\r" not in result

    def test_truncates_to_max_length(self):
        long = "a" * 500
        assert len(sanitize_input(long, max_length=100)) <= 100

    def test_raises_on_non_string(self):
        with pytest.raises(TypeError):
            sanitize_input(12345)  # type: ignore


@pytest.mark.unit
class TestIsValidDomain:
    def test_valid_domains(self):
        assert is_valid_domain("example.com")
        assert is_valid_domain("sub.domain.co.uk")
        assert is_valid_domain("my-domain.io")

    def test_invalid_domains(self):
        assert not is_valid_domain("nodot")
        assert not is_valid_domain(".leading-dot.com")
        assert not is_valid_domain("double..dot.com")
        assert not is_valid_domain("")
