"""Deploy only with the operator's configured AWS credentials; never embeds keys."""
import argparse
import io
import pathlib
import subprocess
import time
import zipfile
import boto3
from botocore.exceptions import ClientError


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--region', default='ap-south-1')
    parser.add_argument('--profile')
    parser.add_argument('--stack', default='sunil-enterprises')
    parser.add_argument('--instance-type', default='t3.small', choices=['t3.small', 't3.medium'])
    args = parser.parse_args()
    root = pathlib.Path(__file__).resolve().parents[2]
    session = boto3.Session(profile_name=args.profile, region_name=args.region)
    identity = session.client('sts').get_caller_identity()
    print('Deploying account', identity['Account'], 'region', args.region, 'stack', args.stack)
    cf, s3 = session.client('cloudformation'), session.client('s3')
    template = (root / 'deploy/aws/stack.yaml').read_text()
    cf.validate_template(TemplateBody=template)
    # Bootstrap deliberately targets a new stack. Updates need the documented backup/release procedure.
    cf.create_stack(StackName=args.stack, TemplateBody=template,
                    Parameters=[{'ParameterKey': 'InstanceType', 'ParameterValue': args.instance_type}],
                    Capabilities=['CAPABILITY_IAM'], OnFailure='DO_NOTHING')
    bucket = None
    for _ in range(120):
        try:
            bucket = cf.describe_stack_resource(StackName=args.stack, LogicalResourceId='Artifacts')['StackResourceDetail']['PhysicalResourceId']
            if bucket:
                break
        except ClientError:
            pass
        time.sleep(5)
    if not bucket:
        raise RuntimeError('Artifact bucket was not created; inspect CloudFormation stack events.')
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    archive = io.BytesIO()
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as release:
        for path in filter(None, paths):
            release.write(root / path, path)
    s3.put_object(Bucket=bucket, Key='releases/current.zip', Body=archive.getvalue(), ServerSideEncryption='AES256')
    cf.get_waiter('stack_create_complete').wait(StackName=args.stack)
    outputs = {o['OutputKey']: o['OutputValue'] for o in cf.describe_stacks(StackName=args.stack)['Stacks'][0]['Outputs']}
    print('Infrastructure created. EC2 bootstrap continues independently:')
    for key, value in outputs.items():
        print(key + ':', value)
    print('Inspect bootstrap through SSM, then verify the public HTTPS IP endpoint and its trusted certificate.')
    print('Owner setup and backup secret values remain in AWS Secrets Manager; they are not printed.')


if __name__ == '__main__':
    main()
