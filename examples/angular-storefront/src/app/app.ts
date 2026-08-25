import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { injectEmporix } from '@viu/emporix-sdk-angular';

/**
 * Reads the SDK client back out of Angular's DI.
 *
 * Deliberately more than a compile check: an AOT production build could succeed
 * while `provideEmporix`'s `InjectionToken`s failed to resolve at runtime — for
 * instance if the optimizer dropped something it thought was unused. Rendering a
 * value that only exists if injection worked turns the build into a real probe.
 *
 * Decorators are fine HERE. This app is compiled by the Angular CLI; the
 * no-decorator rule applies to `packages/angular`, which is not.
 */
@Component({
  imports: [RouterOutlet],
  selector: 'app-root',
  styleUrl: './app.css',
  templateUrl: './app.html',
})
export class App {
  private readonly emporix = injectEmporix();
  protected readonly tenant = this.emporix.client.tenant;
  protected readonly storageKind = this.emporix.storage.getCustomerToken() === null
    ? 'no customer token'
    : 'customer token present';
}
