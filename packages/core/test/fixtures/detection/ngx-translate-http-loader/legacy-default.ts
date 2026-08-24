import * as ngxHttp from '@ngx-translate/http-loader';

declare const http: unknown;

export const loader = new ngxHttp.TranslateHttpLoader(http);
