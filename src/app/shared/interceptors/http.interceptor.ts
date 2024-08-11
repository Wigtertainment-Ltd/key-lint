import { Location } from '@angular/common';
import { HttpErrorResponse, HttpEvent, HttpHandler, HttpInterceptor, HttpRequest, HttpResponse } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, map, of, throwError } from 'rxjs';
import { LocalStorageKeys, LocalStorageService } from '../services';

@Injectable()
export class HTTPInterceptor implements HttpInterceptor {
	constructor(
		private localService: LocalStorageService,
		private router: Router,
		private location: Location
	) { }

	intercept(request: HttpRequest<any>, next: HttpHandler): Observable<any> {
		if (!request.url.includes('auth')) {
			const accessToken: string | null = this.localService.get(LocalStorageKeys.AccessToken);
			if (accessToken) {
				request = request.clone({
					setHeaders: {
						Authorization: `Bearer ${accessToken}`
					}
				});
			}
		}

		return next.handle(request).pipe(
			catchError((error: HttpErrorResponse) => {
				if (error instanceof HttpErrorResponse && error.status === 401) {
					return this.handleUnauthorizedError(request, next, error);
				} else {
					return throwError(() => error);
				}
			}),
			map(res => {
				if (res instanceof HttpResponse) {
					const accessToken: string = res.headers.get('Accesstoken');
					if (accessToken) {
						this.localService.set(LocalStorageKeys.AccessToken, accessToken);
					}
					const refreshToken: string = res.headers.get('Refreshtoken');
					if (refreshToken) {
						this.localService.set(LocalStorageKeys.RefreshToken, refreshToken);
					}
				}
				return res;
			}));
	}

	private handleUnauthorizedError(request: HttpRequest<unknown>, next: HttpHandler, error: HttpErrorResponse): Observable<HttpEvent<unknown>> | Observable<HttpRequest<unknown>> {
		const refreshtoken: string = this.localService.get(LocalStorageKeys.RefreshToken);
		this.localService.remove(LocalStorageKeys.AccessToken);

		if ((!this.router.url.includes('login') || (this.router.url.includes('login') && refreshtoken))) {
			if (refreshtoken) {
				this.localService.remove(LocalStorageKeys.RefreshToken);
				return next.handle(request.clone({ setHeaders: { Authorization: `Bearer ${refreshtoken}` } }));
			} else {
				try {
					if (error.status === 401) {
						this.localService.remove(LocalStorageKeys.AccessToken);
						this.localService.remove(LocalStorageKeys.RefreshToken);
						void this.router.navigate([`/login`]);
					} else {
						this.location.back();
					}
				} catch (e) {
					return throwError(() => error);
				}
				return throwError(() => new Error('no refreshtoken'));
			}
		} else {
			return of(request);
		}
	}
}
