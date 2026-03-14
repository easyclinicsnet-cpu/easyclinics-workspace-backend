import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Aes256Service } from './aes-256.service';

// Property decorator that encrypts values when set
export function EncryptedField() {
  return (target: any, propertyKey: string) => {
    let encryptedValue: string;

    const getter = function() {
      return encryptedValue;
    };

    const setter = async function(this: any, newVal: string) {
      // Get Aes256Service instance through DI
      const aesService = this.aes256Service ||
        (this.constructor.prototype.aes256Service instanceof Aes256Service
          ? this.constructor.prototype.aes256Service
          : null);

      if (!aesService) {
        throw new Error('Aes256Service not found. Make sure it\'s injected in the class');
      }

      encryptedValue = newVal ? await aesService.encrypt(newVal) : newVal;
    };

    Object.defineProperty(target, propertyKey, {
      get: getter,
      set: setter,
      enumerable: true,
      configurable: true,
    });
  };
}

// Parameter decorator that decrypts incoming data
export const Decrypted = createParamDecorator(
  async (data: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const aesService = ctx.switchToHttp().getRequest().aes256Service; // Should be injected via middleware/interceptor

    if (!aesService) {
      throw new Error('Aes256Service not available on request');
    }

    if (request.body.encryptedData) {
      try {
        return await aesService.decrypt(request.body.encryptedData);
      } catch (error) {
        throw new Error('Failed to decrypt data');
      }
    }
    return null;
  }
);

// Alternative approach using a class decorator to handle DI
export function WithEncryption() {
  return function <T extends new (...args: any[]) => any>(constructor: T) {
    return class extends constructor {
      constructor(...args: any[]) {
        super(...args);
        const aesService = args.find(arg => arg instanceof Aes256Service);
        if (!aesService) {
          throw new Error('Aes256Service must be injected');
        }
        this.aes256Service = aesService;
      }
    };
  };
}
