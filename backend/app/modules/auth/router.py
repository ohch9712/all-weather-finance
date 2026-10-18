from fastapi import APIRouter, Depends, Request, Response

from app.api.deps import CurrentUser, DBSession, require_json
from app.core.config import get_settings
from app.core.cookies import clear_session_cookie, set_session_cookie
from app.modules.auth import service
from app.modules.auth.schemas import (
    AuthPayload,
    DeleteAccountRequest,
    LoginRequest,
    ProfileOut,
    ProfileUpdate,
    SignupRequest,
)

auth_router = APIRouter(prefix="/auth", tags=["auth"])
profile_router = APIRouter(prefix="/profile", tags=["profile"])


@auth_router.post(
    "/signup", status_code=201, response_model=AuthPayload, dependencies=[Depends(require_json)]
)
def signup(data: SignupRequest, request: Request, response: Response, db: DBSession):
    payload, token = service.signup(
        db, data, request.cookies.get(get_settings().session_cookie_name)
    )
    set_session_cookie(response, token)
    return payload


@auth_router.post("/login", response_model=AuthPayload, dependencies=[Depends(require_json)])
def login(data: LoginRequest, request: Request, response: Response, db: DBSession):
    payload, token = service.login(
        db, str(data.email), data.password, request.cookies.get(get_settings().session_cookie_name)
    )
    set_session_cookie(response, token)
    return payload


@auth_router.post("/logout", status_code=204, dependencies=[Depends(require_json)])
def logout(request: Request, db: DBSession):
    service.logout(db, request.cookies.get(get_settings().session_cookie_name))
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


@auth_router.get("/me", response_model=AuthPayload)
def me(db: DBSession, user: CurrentUser):
    return service.auth_payload(db, user)


@auth_router.delete("/me", status_code=204, dependencies=[Depends(require_json)])
def delete_me(data: DeleteAccountRequest, db: DBSession, user: CurrentUser):
    service.delete_account(db, user, data.password.get_secret_value())
    response = Response(status_code=204)
    clear_session_cookie(response)
    return response


@profile_router.get("", response_model=ProfileOut)
def get_profile(db: DBSession, user: CurrentUser):
    return service.get_profile(db, user.id)


@profile_router.put("", response_model=ProfileOut, dependencies=[Depends(require_json)])
def update_profile(data: ProfileUpdate, db: DBSession, user: CurrentUser):
    return service.update_profile(db, user.id, data)
