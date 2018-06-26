import {Lambda} from 'aws-sdk';
import {Callback} from "aws-lambda";

export function invokelambdaAsync(context: string, func: string, payload: object): Promise<object> {
    const params = {
        ClientContext: context,
        FunctionName: func,
        InvocationType: "Event", // this is an async invocation
        LogType: "None",
        Payload: JSON.stringify(payload),
    };
    const lambda = new Lambda();
    return new Promise(function (fulfill, reject) {
        lambda.invoke(params, function (err, data) {
            if (err) {
                reject(err);
            } else {
                console.log(func + " invoked apparently successfully");
                fulfill(data);
            }
        });
    });
}

export function invokelambdaSync(context: string, func: string, payload: object): Promise<object> {
    const params = {
        ClientContext: undefined,
        FunctionName: func,
        InvocationType: "RequestResponse", // this is a synchronous invocation
        LogType: "None",
        Payload: JSON.stringify(payload),
    };
    const lambda = new Lambda();
    return new Promise(function (fulfill, reject) {
        lambda.invoke(params, function(err, data) {
            if (err) {
                reject(err);
            } else {
                fulfill(JSON.parse(data.Payload.toString()));
            }
        });
    });
}

export function between(s: string, before: string, after: string): string {
    const i = s.indexOf(before);
    if (i < 0) return "";
    s = s.substring(i+before.length);
    const j = s.indexOf(after);
    if (j < 0) return "";
    return s.substring(0, j);
}

export function promiseToCallback<T>(promise: Promise<T>, callback: Callback) {
    promise
        .then(v => callback(undefined, v))
        .catch(err => callback(err));
}
